// Generates a support structure for a mesh with the given vertices and faces.
// This is a modified version of "Clever Support: Efficient Support Structure
// Generation for Digital Fabrication" by Vanek et al. The main difference is
// that we don't use the GPU to find the nearest point-mesh interesection,
// instead using an octree to check the down and diagonal directions only.
//
// params:
//  faces, vertices: the geometry of the mesh for which we'll generate supports
function SupportGenerator(faces, vertices) {
  this.faces = faces;
  this.vertices = vertices;

  this.octree = null;
}

// params:
//  angleDegrees: the maximal angle, given in degrees, between a face's normal
//    and the downward vector; essentially specifies the steepness range in
//    which faces require support
//  resolution: horizontal resolution for spacing out support points
//  layerHeight: for finding points that don't need supporting
//  supportRadius: radius of support struts
//  axis: up axis
//  min, max: min and max bounds of the mesh
//  epsilon: optional
SupportGenerator.prototype.generate = function(
    angleDegrees,
    resolution,
    layerHeight,
    supportRadius,
    axis,
    min,
    max,
    epsilon
) {
  if (axis === undefined) axis = 'z';
  if (epsilon === undefined) epsilon = 0.0000001;

  // axes in the horizontal plane
  var ah = cycleAxis(axis);
  var av = cycleAxis(ah);

  // angle in radians
  var angle = (90 - angleDegrees) * Math.PI / 180;
  var minHeight = min[axis] + layerHeight/2;
  var resolution = resolution;

  var vs = this.vertices;
  var fs = this.faces;

  var nv = vs.length;
  var nf = fs.length;

  // used to determine overhangs
  var dotProductCutoff = Math.cos(Math.PI / 2 - angle);

  var down = new THREE.Vector3();
  down[axis] = -1;
  var up = down.clone().negate();

  var hds = new HDS(vs, fs);

  // generate islands of overhang faces in the mesh
  var overhangFaceSets = getOverhangFaceSets(hds);

  // rasterize each overhang face set to find sampling points over every set
  var pointSets = samplePoints(overhangFaceSets);

  // need an octree for raycasting

  if (this.octree === null) {
    // octree size is some epsilon plus largest mesh size
    var octreeOverflow = 0.01;
    var octreeSize = vector3MaxElement(max.clone().sub(min)) + octreeOverflow;
    // other params
    var octreeDepth = Math.round(Math.log(fs.length)*0.6);
    var octreeCenter = max.clone().add(min).multiplyScalar(0.5);
    var octreeOrigin = octreeCenter.subScalar((octreeSize + octreeOverflow)/2);

    this.octree = new Octree(octreeDepth, octreeOrigin, octreeSize, fs, vs);
    this.octree.construct();
  }

  var octree = this.octree;

  // construct a Geometry object with the support verts and faces
  //var supportGeometry = buildGeometry();

  //return supportGeometry;

  var supportTrees = buildSupportTrees();

  for (var s=0; s<supportTrees.length; s++) {
    var tree = supportTrees[s];
    tree.debug();
    tree.makeProfiles(0.1);
  }

  function getOverhangFaceSets(hds) {
    // return true if the given HDS face is an overhang and above the base plane
    var overhang = function(face) {
      var face3 = face.face3;
      var normal = face3.normal;
      var mx = faceGetMaxAxis(face3, vs, axis);
      return down.dot(normal) > dotProductCutoff && mx > minHeight;
    }

    //return hds.groupIntoIslands(overhang);
    return [hds.filterFaces(overhang)];
  }

  function samplePoints(faceSets) {
    var pointSets = [];

    // rasterization lower bounds on h and v axes
    var rhmin = min[ah];
    var rvmin = min[av];

    // for each face set
    for (var i = 0; i < faceSets.length; i++) {
      var faceSet = faceSets[i];
      var faces = faceSet.faces;
      var points = [];

      // iterate over all faces in the face set
      for (var f = 0; f < faces.length; f++) {
        var face3 = faces[f].face3;
        var normal = face3.normal;
        var [a, b, c] = faceGetVerts(face3, vs);
        // bounding box
        var bb = faceGetBounds(face3, vs);

        // this face's lower bounds in rasterization space
        var hmin = rhmin + Math.floor((bb.min[ah] - rhmin) / resolution) * resolution;
        var vmin = rvmin + Math.floor((bb.min[av] - rvmin) / resolution) * resolution;
        // this face's upper bounds in rasterization space
        var hmax = rhmin + Math.ceil((bb.max[ah] - rhmin) / resolution) * resolution;
        var vmax = rvmin + Math.ceil((bb.max[av] - rvmin) / resolution) * resolution;

        // iterate over all possible points
        for (var ph = hmin; ph < hmax; ph += resolution) {
          for (var pv = vmin; pv < vmax; pv += resolution) {
            var pt = new THREE.Vector3();
            pt[ah] = ph;
            pt[av] = pv;

            // two triangle verts are flipped because the triangle faces down
            // and is thus wound CW when looking into the plane
            if (pointInsideTriangle(pt, b, a, c, axis, epsilon)) {
              points.push(projectToPlaneOnAxis(pt, a, normal, axis));
            }
          }
        }
      }

      // if the point set is too small to hit any points in rasterization space,
      // just store the center of its first face
      if (points.length == 0 && faceSet.count > 0) {
        var center = faceGetCenter(faces[0].face3, vs);
        points.push(center);
      }

      pointSets.push(points);
    }

    return pointSets;
  }

  function buildSupportTrees() {
    // iterate through sampled points, build support trees
    var supportGeometry = new THREE.Geometry();
    var strutRadius = supportRadius;
    var strutThetaSteps = 1;
    var strutPhiSteps = 8;
    // set this to 1 for spherical caps; setting this larger than 1 elongates
    // the cap along the axis of the capsule
    var strutSpikeFactor = 2;

    // list of support tree roots
    var result = [];

    // for every island's point set
    for (var psi = 0; psi < pointSets.length; psi++) {
      var points = pointSets[psi];

      // support tree nodes for this island
      var nodes = [];

      // orders a priority queue from highest to lowest coordinate on axis
      var pqComparator = function (a, b) { return nodes[b].v[axis] - nodes[a].v[axis]; }
      var pq = new PriorityQueue({
        comparator: pqComparator
      });
      var activeIndices = new Set();

      // put the point indices on the priority queue;
      // also put them into a set of active indices so that we can take a point
      // and test it against all other active points to find the nearest
      // intersection; we could just iterate over the pq.priv.data to do the same,
      // but that's a hack that breaks encapsulation
      for (var pi = 0; pi < points.length; pi++) {
        nodes.push(new SupportTreeNode(points[pi]));
        activeIndices.add(pi);
        pq.queue(pi);
      }

      var ct = 0;
      while (pq.length > 0) {
        var pi = pq.dequeue();

        if (!activeIndices.has(pi)) continue;
        activeIndices.delete(pi);

        var p = nodes[pi];

        // find the closest intersection between p's cone and another cone
        var intersection = null;
        var minDist = Infinity;
        var qiFinal = -1;

        for (var qi of activeIndices) {
          var q = nodes[qi];
          var ixn = coneConeIntersection(p.v, q.v, angle, axis);

          // if valid intersection and it's inside the mesh boundary
          if (ixn && ixn[axis] > minHeight) {
            var dist = p.v.distanceTo(ixn);
            if (dist < minDist) {
              minDist = dist;
              intersection = ixn;
              qiFinal = qi;
            }
          }
        }

        // build one or two struts

        // will need to check if connecting down is cheaper than connecting in
        // the direction of intersection
        var rayDown = octree.castRayExternal(p.v, down);
        // ray may hit the bottom side of the octree, which may not coincide
        // with mesh min
        rayDown.point[axis] = Math.max(rayDown.point[axis], minHeight);
        rayDown.dist = Math.min(rayDown.dist, rayDown.point[axis] - min[axis]);

        // one or two nodes will connect to the target point
        var q = null;
        var target = null;

        // if p-q intersection exists, either p and q connect or p's ray to q hits
        // the mesh first
        if (intersection) {
          var d = intersection.clone().sub(p.v).normalize();
          var rayQ = octree.castRayExternal(p.v, d);

          // if p's ray to the intersection hits the mesh first, join it to the
          // mesh and leave q to join to something else later
          if (rayQ.dist < minDist) {
            // hit along p's ray to intersection is closer, so join there
            if (rayQ.dist < rayDown.dist) {
              target = rayQ.point;
            }
            // downward connection is closer, so join downward
            else {
              target = rayDown.point;
            }
          }
          // p and q can be safely joined
          else {
            q = nodes[qiFinal];
            target = intersection;
          }
        }
        // if no intersection between p and q, cast a ray down and build a strut
        // where it intersects the mesh or the ground
        else {
          target = rayDown.point;
        }

        nodes.push(new SupportTreeNode(target, p, q));

        if (q !== null) {
          activeIndices.delete(qiFinal);

          var newidx = nodes.length - 1;
          activeIndices.add(newidx);
          pq.queue(newidx);
        }
      }

      // store the root nodes
      for (var i = 0; i < nodes.length; i++) {
        if (nodes[i].isRoot()) result.push(nodes[i]);
      }
    }

    //supportGeometry.computeFaceNormals();

    return result;



    function writeCapsuleGeometry(geo, start, end) {
      writeCapsuleGeometryImpl(
        geo, strutRadius, start, end, strutPhiSteps, strutThetaSteps, strutSpikeFactor
      );
    }

    function writeSphereGeometry(geo, center) {
      writeSphereGeometryImpl(
        geo, strutRadius * 1.1, center, strutPhiSteps, strutPhiSteps
      );
    }
  }

  // takes a geometry object and writes a capsule into it with the given radius,
  // start position, end position, and phi/theta increments; my convention for
  // spherical coords is that phi goes to 2pi, theta to pi, and so:
  //  x = r cos phi sin theta
  //  y = r sin phi sin theta
  //  z = r cos theta
  function writeCapsuleGeometryImpl(geo, radius, start, end, phiSteps, thetaSteps, spikeFactor) {
    var len = start.distanceTo(end);

    phiSteps = Math.max(phiSteps || 3, 3);
    thetaSteps = Math.max(thetaSteps || 8, 1);

    var direction = end.clone().sub(start).normalize();
    var rotationAxis = up.clone().cross(direction).normalize();
    var rotationAngle = Math.acos(direction.dot(up));

    // if start-to-end direction is vertical, don't rotate
    if (rotationAxis.length() == 0) {
      rotationAngle = 0;
      // capsule remains vertical; just set the lower of start and end as start
      if (start[axis] > end[axis]) {
        var tmp = start;
        start = end;
        end = tmp;
      }
    }

    var capOffset = radius * spikeFactor / 2.5;

    // centers for the top and bottom caps
    var bot = new THREE.Vector3();
    var top = up.clone().multiplyScalar(len);
    // shift the top and bottom caps to accommodate for the length of the spike,
    // but only if this doesn't cause them to intersect each other
    if (capOffset < len/2) {
      bot[axis] += capOffset;
      top[axis] -= capOffset;
    }
    // if moving the caps makes them intersect each other, just make spherical caps
    else {
      spikeFactor = 1;
    }

    // make the bottom cap
    var ibot = writeCapsuleCap(geo, radius, bot, phiSteps, thetaSteps, -1, spikeFactor);

    // make the top cap
    var itop = writeCapsuleCap(geo, radius, top, phiSteps, thetaSteps, 1, spikeFactor);

    // count the number of verts in this capsule, then rotate and translate
    // them into place
    var count = 2 * (1 + phiSteps * thetaSteps);
    positionCapsuleGeometry(geo, count, rotationAngle, rotationAxis, start);

    writeCapsuleTorso(geo, ibot, itop, phiSteps);

    geo.elementsNeedUpdate = true;
    geo.verticesNeedUpdate = true;
    geo.normalsNeedUpdate = true;

    return;
  }

  // dir is 1 if upper cap, -1 if lower
  // returns length of geo.vertices
  function writeCapsuleCap(geo, radius, center, phiSteps, thetaSteps, dir, spikeFactor) {
    var vertices = geo.vertices;
    var faces = geo.faces;

    // theta is 0 if dir==1 (top cap), else pi
    var thetaStart = (1 - dir) * Math.PI / 2;
    var dtheta = dir * Math.PI / (2 * thetaSteps);
    var dphi = dir * Math.PI * 2 / phiSteps;

    var scaleFactor = new THREE.Vector3().setScalar(1);
    scaleFactor[axis] = spikeFactor;

    var nv = vertices.length;

    // vertices

    // top of the cap
    vertices.push(vertexFromSpherical(radius, thetaStart, 0, center, scaleFactor));

    // rest of the cap
    for (var itheta = 1; itheta <= thetaSteps; itheta++) {
      var theta = thetaStart + itheta * dtheta;

      for (var iphi = 0; iphi < phiSteps; iphi++) {
        var phi = iphi * dphi;

        vertices.push(vertexFromSpherical(radius, theta, phi, center, scaleFactor));
      }
    }

    // faces

    var idx = nv;

    for (var itheta = 1; itheta <= thetaSteps; itheta++) {
      for (var iphi = 0; iphi < phiSteps; iphi++) {
        idx++;

        // a-b is a segment on the previous row
        // c-d is the corresponding segment on the current row
        var a = (itheta == 1) ? nv : (idx - phiSteps);
        var b = a + 1;
        var c = idx;
        var d = c + 1;
        if (iphi == phiSteps - 1) {
          b -= phiSteps;
          d -= phiSteps;
        }

        faces.push(new THREE.Face3(a, c, d));

        // add a second face if not on the first row of the cap
        if (itheta > 1) faces.push(new THREE.Face3(a, d, b));
      }
    }

    return vertices.length;
  }

  // takes the last count verts from geo, rotates them, shifts them to pos
  function positionCapsuleGeometry(geo, count, rotationAngle, rotationAxis, pos) {
    var vertices = geo.vertices;
    var nv = vertices.length;

    for (var i = nv - count; i < nv; i++) {
      var v = vertices[i];

      if (rotationAngle !== 0) v.applyAxisAngle(rotationAxis, rotationAngle);

      v.add(pos);
    }
  }

  // botEnd is 1 + the last index in bottom cap; analogously for top
  function writeCapsuleTorso(geo, botEnd, topEnd, phiSteps) {
    var vertices = geo.vertices;
    var faces = geo.faces;

    for (var i = 0; i < phiSteps; i++) {
      var a = topEnd + i - phiSteps;
      var b = a + 1;
      if (i == phiSteps - 1) b -= phiSteps;
      var c = botEnd - i;
      var d = c - 1;
      if (i == 0) c -= phiSteps;

      faces.push(new THREE.Face3(a, c, d));
      faces.push(new THREE.Face3(a, d, b));
    }
  }

  // write a new sphere into a geometry object
  function writeSphereGeometryImpl(geo, radius, center, phiSteps, thetaSteps) {
    var sphereGeometry = new THREE.SphereGeometry(
      radius, thetaSteps, phiSteps
    );
    sphereGeometry.translate(center.x, center.y, center.z);

    var vertices = geo.vertices;
    var faces = geo.faces;
    var svertices = sphereGeometry.vertices;
    var sfaces = sphereGeometry.faces;

    var nv = vertices.length;

    // write vertices
    for (var i = 0; i < svertices.length; i++) {
      vertices.push(svertices[i]);
    }

    // write faces
    for (var i = 0; i < sfaces.length; i++) {
      var face = sfaces[i].clone();
      face.a += nv;
      face.b += nv;
      face.c += nv;

      faces.push(face);
    }
  }

  function vertexFromSpherical(r, theta, phi, center, scale) {
    var v = new THREE.Vector3();
    var cp = Math.cos(phi);
    var sp = Math.sin(phi);
    var ct = Math.cos(theta);
    var st = Math.sin(theta);

    v.x = r * cp * st * scale.x + center.x;
    v.y = r * sp * st * scale.y + center.y;
    v.z = r * ct * scale.z + center.z;

    return v;
  }
}

SupportGenerator.prototype.cleanup = function() {
  debug.cleanup();
}



// a node in a tree of support nodes
// params:
//  v: vertex at which this node is placed
//  b0, b1: this node's branches, if any
function SupportTreeNode(v, b0, b1) {
  this.v = v;

  // every node is a root when created; when connected as a branch node to
  // another node, it stops being root
  this.source = null;

  // branch nodes
  this.b0 = b0 || null;
  this.b1 = b1 || null;

  // if connected a branch node, that node is no longer root
  if (b0) b0.source = this;
  if (b1) b1.source = this;
}

SupportTreeNode.prototype.isRoot = function() {
  return this.source === null;
}

SupportTreeNode.prototype.isLeaf = function() {
  return this.b0 === null && this.b1 === null;
}

SupportTreeNode.prototype.debug = function() {
  if (this.b0) {
    debug.line(this.v, this.b0.v);
    this.b0.debug();
  }
  if (this.b1) {
    debug.line(this.v, this.b1.v);
    this.b1.debug();
  }

  if (false && this.b0 && this.b1) {
    var a0 = this.v.clone().addScaledVector(sm, 0.2);
    var a1 = this.v.clone().addScaledVector(sm, -0.1);
    debug.line(this.v, a0);
    debug.line(this.v, a1);

    debug.ray(this.v, v0.clone().add(v1), 0.1);
    debug.ray(this.v, v1.clone().add(vs), 0.1);
    debug.ray(this.v, vs.clone().add(v0), 0.1);
  }

  if (this.isRoot()) debug.lines(12);
}

// build the profiles of vertices where the cylindrical struts will join or end;
// cases for nodes:
//  root: make a circular profile and recurse to branches
//  leaf: make a circular profile
//  internal: form three half-ellipse profiles joined at the two points where
//    all three struts meet, then recurse to branches
SupportTreeNode.prototype.makeProfiles = function(radius) {
  if (this.isRoot()) {
    if (this.b0) this.b0.makeProfiles(radius);
    if (this.b1) this.b1.makeProfiles(radius);
  }
  else if (this.isLeaf()) {

  }
  else {
    // outgoing vectors down the adjoining struts
    var v0 = this.b0.v.clone().sub(this.v).normalize();
    var v1 = this.b1.v.clone().sub(this.v).normalize();
    var vs = this.source.v.clone().sub(this.v).normalize();

    // bisectors between adjoining struts
    var b01 = v0.clone().add(v1).normalize();
    var b0s = v0.clone().add(vs).normalize();
    var b1s = v1.clone().add(vs).normalize();

    // angles between each strut and the halfplanes separating them from the
    // adjoining struts
    var a01 = Math.acos(v0.dot(v1)) / 2;
    var a0s = Math.acos(v0.dot(vs)) / 2;
    var a1s = Math.acos(v1.dot(vs)) / 2;

    // distance from center to the farthest intersection of two struts
    var m01 = radius / Math.sin(a01);
    var m0s = radius / Math.sin(a0s);
    var m1s = radius / Math.sin(a1s);

    // farthest intersection points between pairs of struts
    var i01 = b01.clone().multiplyScalar(m01);
    var i0s = b0s.clone().multiplyScalar(m0s);
    var i1s = b1s.clone().multiplyScalar(m1s);

    if (b01.dot(vs) > 0) i01.negate();
    if (b0s.dot(v1) > 0) i0s.negate();
    if (b1s.dot(v0) > 0) i1s.negate();

    debug.ray(this.v, i01, m01);
    //debug.ray(this.v, i0s, m0s);
    //debug.ray(this.v, i1s, m1s);

    // compute the inward and outward intersection points of the struts
    var cross = v0.clone().cross(v1);

    // unit vectors to inward and outward vertices
    var ihat, ohat;
    // magnitude of inward/outward vectors
    var mio;

    // if vectors lie in the same plane, use the cross-product of any two
    if (cross.dot(vs) === 0) {
      ihat = cross;
      mio = radius;
    }
    // else, calculate from normalized strut vectors and set length correctly
    else {
      // find the normal to the plane formed by the strut vectors
      var v01 = v1.clone().sub(v0);
      var v0s = vs.clone().sub(v0);
      ihat = v01.cross(v0s).normalize();

      // correct sign in case inward vector points outward
      var dot = ihat.dot(v1);
      if (dot < 0) ihat.negate();

      // magnitude of in/out vector is r / sin(acos(dot)), where dot is the
      // cosine of the angle between ihat and one of the strut vectors (this is
      // mathematically equivalent to the square root thing)
      mio = radius / Math.sqrt(1 - dot*dot);
    }

    // set inward and outward vectors
    var inward = ihat.clone().setLength(mio);
    // outward is just the opposite of inward
    var outward = inward.clone().negate();

    // dot products between inward unit vector and intersection vectors
    var d01 = ihat.dot(b01);
    var d0s = ihat.dot(b0s);
    var d1s = ihat.dot(b1s);

    // determine starting angles for each ellipse; the major axis is at 0, the
    // intersection of the ellipse with the inward point is at the starting
    // angle, starting angle - pi is the ending angle
    var s01 = Math.acos(d01);
    var s0s = Math.acos(d0s);
    var s1s = Math.acos(d1s);

    // ellipse major axis length is m01... with unit vectors b01...; now
    // compute minor axes with length n01... and unit vectors c01...

    // vectors orthogonal to major axes
    var p01 = projectOut(inward, b01);
    var p0s = projectOut(inward, b0s);
    var p1s = projectOut(inward, b1s);

    // minor axis magnitudes
    var n01 = p01.length() / Math.sqrt(1 - d01*d01);
    var n0s = p0s.length() / Math.sqrt(1 - d0s*d0s);
    var n1s = p1s.length() / Math.sqrt(1 - d1s*d1s);

    // unit vectors along minor axes
    var c01 = p01.clone().normalize();
    var c0s = p0s.clone().normalize();
    var c1s = p1s.clone().normalize();

    for (var ia=0; ia<17; ia++) {
      var a = s01 - ia*Math.PI/18;
      debug.point(
        this.v.clone()
        .addScaledVector(b01, m01*Math.cos(a))
        .addScaledVector(c01, n01*Math.sin(a))
      );
    }

    for (var ia=0; ia<17; ia++) {
      var a = s0s - ia*Math.PI/18;
      debug.point(
        this.v.clone()
        .addScaledVector(b0s, m0s*Math.cos(a))
        .addScaledVector(c0s, n0s*Math.sin(a))
      );
    }

    for (var ia=0; ia<17; ia++) {
      var a = s1s - ia*Math.PI/18;
      debug.point(
        this.v.clone()
        .addScaledVector(b1s, m1s*Math.cos(a))
        .addScaledVector(c1s, n1s*Math.sin(a))
      );
    }

    console.log(mio, n01);

    debug.ray(this.v, c01, n01);
    debug.ray(this.v, c01, -n01);
    //debug.ray(this.v, c0s, n0s);
    //debug.ray(this.v, c1s, n1s);

    debug.line(this.v, this.v.clone().add(inward));
    debug.line(this.v, this.v.clone().add(outward));

    this.b0.makeProfiles(radius);
    this.b1.makeProfiles(radius);
  }

  if (this.isRoot()) debug.lines(10);
}
