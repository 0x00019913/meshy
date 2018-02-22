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
  var supportGeometry = buildGeometry();

  return supportGeometry;



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
      if (points.length == 0) {
        var center = faceGetCenter(faces[0].face3, vs);
        points.push(center);
      }

      pointSets.push(points);
    }

    return pointSets;
  }

  function buildGeometry() {
    // iterate through sampled points, build support trees
    var supportGeometry = new THREE.Geometry();
    var strutRadius = supportRadius;
    var strutThetaSteps = 1;
    var strutPhiSteps = 8;
    // set this to 1 for spherical caps; setting this larger than 1 elongates
    // the cap along the axis of the capsule
    var strutSpikeFactor = 2;

    // for every island's point set
    for (var psi = 0; psi < pointSets.length; psi++) {
      var points = pointSets[psi];

      // orders a priority queue from highest to lowest coordinate on axis
      var pqComparator = function (a, b) { return points[b][axis] - points[a][axis]; }
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
        activeIndices.add(pi);
        pq.queue(pi);
      }

      while (pq.length > 0) {
        var pi = pq.dequeue();

        if (!activeIndices.has(pi)) continue;
        activeIndices.delete(pi);

        var p = points[pi];

        // find the closest intersection between p's cone and another cone
        var intersection = null;
        var minDist = Infinity;
        var qiTarget = -1;

        for (var qi of activeIndices) {
          var q = points[qi];
          var ixn = coneConeIntersection(p, q, angle, axis);
          // if valid intersection and it's inside the mesh boundary
          if (ixn && ixn[axis] > minHeight) {
            var dist = p.distanceTo(ixn);
            if (dist < minDist) {
              minDist = dist;
              intersection = ixn;
              qiTarget = qi;
            }
          }
        }

        // will need to check if connecting down is cheaper than connecting in
        // the direction of intersection
        var rayDown = octree.castRayExternal(p, down);

        // if p-q intersection exists, either p and q connect or p's ray to q hits
        // the mesh first
        if (intersection) {
          var qTarget = points[qiTarget];
          var d = intersection.clone().sub(p);
          var rayQ = octree.castRayExternal(p, d);

          // if p's ray to the intersection hits the mesh first, join it to the
          // mesh and leave q to join to something else later
          if (rayQ.dist < minDist) {
            // hit along p's ray to intersection is closer, so join there
            if (rayQ.dist < rayDown.dist) {
              writeCapsuleGeometry(supportGeometry, p, rayQ.point);
            }
            // downward connection is closer, so join downward
            else {
              // ray hits the bottom side of the octree, which may not coincide
              // with mesh min
              rayDown.point[axis] = Math.max(rayDown.point[axis], minHeight);
              writeCapsuleGeometry(supportGeometry, p, rayDown.point);
            }
          }
          // p and q can be safely joined
          else {
            activeIndices.delete(qiTarget);

            var newidx = points.length;
            points.push(intersection);
            activeIndices.add(newidx);
            pq.queue(newidx);

            // write two capsules as struts, joined at intersection
            writeCapsuleGeometry(supportGeometry, p, intersection);
            writeCapsuleGeometry(supportGeometry, points[qiTarget], intersection);

            // write a sphere as a "joint" between struts
            writeSphereGeometry(supportGeometry, intersection);
          }
        }
        // if no intersection between p and q, cast a ray down and build a strut
        // where it intersects the mesh or the ground
        else {
          // ray hits the bottom side of the octree, which may not coincide
          // with mesh min
          rayDown.point[axis] = Math.max(rayDown.point[axis], minHeight);
          writeCapsuleGeometry(supportGeometry, p, rayDown.point);
        }
      }
    }

    supportGeometry.computeFaceNormals();

    return supportGeometry;



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
