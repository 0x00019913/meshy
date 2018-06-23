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
  var minHeight = min[axis];
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

  var supportTrees = buildSupportTrees();

  var supportTreeGeometry = new THREE.Geometry();

  for (var s=0; s<supportTrees.length; s++) {
    var tree = supportTrees[s];
    //tree.debug();
    tree.writeToGeometry(supportTreeGeometry, supportRadius, 16, 2);
  }

  supportTreeGeometry.computeFaceNormals();

  return supportTreeGeometry;

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

    return result;
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
  this.b0 = (b0 ? b0 : b1) || null;
  this.b1 = (b0 ? b1 : null) || null;

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

  if (this.isRoot()) debug.lines(12);
}

SupportTreeNode.prototype.writeToGeometry = function(geo, radius, subdivs, spikeFactor) {
  if (!this.isRoot()) return null;

  // subdivs must be at least 4 and even
  if (subdivs === undefined || subdivs < 4) subidvs = 4;
  subdivs -= subdivs%2;

  this.makeProfiles(geo, radius, subdivs, spikeFactor);
  this.connectProfiles(geo, radius, subdivs, spikeFactor);
}

// build the profiles of vertices where the cylindrical struts will join or end;
// cases for nodes:
//  root: make a circular profile and recurse to branches
//  leaf: make a circular profile
//  internal: form three half-ellipse profiles joined at the two points where
//    all three struts meet, then recurse to branches
// params:
//  geo: geometry object
//  radius: strut radius
//  subdivs: the number of sides on each strut; this is even and >= 4
//  spikeFactor: factor that determines the length of the spike attaching the
//    root/leaf nodes to the mesh; length is radius * spikeFactor
SupportTreeNode.prototype.makeProfiles = function(geo, radius, subdivs, spikeFactor) {
  var pi2 = Math.PI * 2;

  var vertices = geo.vertices;

  var isRoot = this.isRoot();
  var isLeaf = this.isLeaf();

  if (isRoot || isLeaf) {
    // node's neighbor; if root, then this is the single branch node; if leaf,
    // this is the source
    var n = isRoot ? this.b0 : this.source;

    if (!n) return;

    // outgoing vector up to the child
    var vn = n.v.clone().sub(this.v).normalize();

    // we can't offset farther than this from the end, else the profile would
    // interfere with any struts connecting to this node
    // (to avoid coincident vertices, add small epsilon * radius to the limit)
    var offsetLimit = this.offsetLimit(radius) - 0.01 * radius;
    // offset spike such that spike length is spikeFactor*radius (or less, if
    // the whole spike can't fit) and it protrudes by at most 0.5 radius from
    // the end of the strut
    var spikeOffset = Math.min(offsetLimit, (spikeFactor - 1) * radius);

    // point where the profile center will go
    var p = this.v.clone().addScaledVector(vn, spikeOffset);

    // two axes orthogonal to strut axis
    var b = orthogonalVector(vn).normalize();
    var c = vn.clone().cross(b);

    // starting index for the profile
    var sidx = vertices.length;

    // profile - array of vertex indices
    var ps = [];

    // angle increment
    var aincr = (isRoot ? 1 : -1) * pi2 / subdivs;

    // push verts and vertex indices to profile
    for (var i=0; i<subdivs; i++) {
      var a = i * aincr;
      vertices.push(
        p.clone()
        .addScaledVector(b, radius * Math.cos(a))
        .addScaledVector(c, radius * Math.sin(a))
      );
      ps.push(sidx + i);
    }

    if (isRoot) this.p0 = ps;
    else this.ps = ps;
  }
  else {
    // outgoing vectors down the adjoining struts
    var v0 = this.b0.v.clone().sub(this.v).normalize();
    var v1 = this.b1.v.clone().sub(this.v).normalize();
    var vs = this.source.v.clone().sub(this.v).normalize();

    // sums of adjacent strut vectors
    var sm01 = v0.clone().add(v1);
    var sm0s = v0.clone().add(vs);
    var sm1s = v1.clone().add(vs);

    // bisectors between adjoining struts
    // default method is to add the two strut vectors; if two strut vectors are
    // antiparallel, use the third strut vector to get the correct bisector
    var b01 = equal(sm01.length(), 0) ? projectOut(vs, v0).negate() : sm01;
    var b0s = equal(sm0s.length(), 0) ? projectOut(v1, vs).negate() : sm0s;
    var b1s = equal(sm1s.length(), 0) ? projectOut(v0, v1).negate() : sm1s;
    // normalize bisectors
    b01.normalize();
    b0s.normalize();
    b1s.normalize();

    // angles between each strut and the halfplanes separating them from the
    // adjoining struts
    var a01 = acos(v0.dot(v1)) / 2;
    var a0s = acos(v0.dot(vs)) / 2;
    var a1s = acos(v1.dot(vs)) / 2;

    // distance from center to the farthest intersection of two struts
    var m01 = radius / Math.sin(a01);
    var m0s = radius / Math.sin(a0s);
    var m1s = radius / Math.sin(a1s);

    // find the normal to the plane formed by the strut vectors
    var v01 = v1.clone().sub(v0);
    var v0s = vs.clone().sub(v0);
    // unit vector to inward vertex; its inverse points to outward vertex
    var ihat = v01.cross(v0s).normalize();

    // correct sign in case inward vector points outward
    var dot = ihat.dot(v1);
    if (dot < 0) ihat.negate();

    // magnitude of in/out vector is r / sin(acos(dot)), where dot is the
    // cosine of the angle between ihat and one of the strut vectors (this is
    // mathematically equivalent to the square root thing)
    var mio = radius / Math.sqrt(1 - dot*dot);

    // An ellipse is specified like so:
    //  x = m cos t
    //  y = n sin t
    // where t is an angle CCW from the major axis. t here is not an actual
    // angle between the (x,y) point and the major axis, but a parameter, so we
    // can't get it straight from a dot product between a point and the axis.
    // I'll call it an angle, though.

    // dot products between inward unit vector and intersection vectors
    var d01 = ihat.dot(b01);
    var d0s = ihat.dot(b0s);
    var d1s = ihat.dot(b1s);

    // determine starting angle params for each ellipse; the major axis is at
    // 0, the intersection of the ellipse with the inward point is at the
    // starting angle, starting angle - pi is the ending angle
    var s01 = acos(mio * d01 / m01);
    var s0s = acos(mio * d0s / m0s);
    var s1s = acos(mio * d1s / m1s);

    // ellipse major axis length is m01... with unit vectors b01...; now
    // compute minor axes with length n01... and unit vectors c01...

    // unit vectors along minor axes
    var c01 = projectOut(ihat, b01).normalize();
    var c0s = projectOut(ihat, b0s).normalize();
    var c1s = projectOut(ihat, b1s).normalize();

    // minor axis magnitudes
    var n01 = mio * Math.sqrt(1 - d01*d01) / Math.sin(s01);
    var n0s = mio * Math.sqrt(1 - d0s*d0s) / Math.sin(s0s);
    var n1s = mio * Math.sqrt(1 - d1s*d1s) / Math.sin(s1s);

    // put the calculated points into the geometry

    // indices of inward and outward vertices
    var inidx = vertices.length;
    var outidx = inidx + 1;
    // push inward and outward vertices
    vertices.push(this.v.clone().addScaledVector(ihat, mio));
    vertices.push(this.v.clone().addScaledVector(ihat, -mio));

    // number of verts in each elliptical arc, excluding endpoints
    var scount = (subdivs - 2) / 2;
    var scount1 = scount + 1;

    // start indices of each arc
    var s01idx = vertices.length;
    var s0sidx = s01idx + scount;
    var s1sidx = s0sidx + scount;

    // push the arc vertices, excluding inward and outward vertices (which are
    // the endpoints of all three arcs)
    for (var ia = 1; ia < scount1; ia++) {
      var a = s01 - ia * Math.PI / scount1;
      vertices.push(
        this.v.clone()
        .addScaledVector(b01, m01 * Math.cos(a))
        .addScaledVector(c01, n01 * Math.sin(a))
      );
    }
    for (var ia = 1; ia < scount1; ia++) {
      var a = s0s - ia * Math.PI / scount1;
      vertices.push(
        this.v.clone()
        .addScaledVector(b0s, m0s * Math.cos(a))
        .addScaledVector(c0s, n0s * Math.sin(a))
      );
    }
    for (var ia = 1; ia < scount1; ia++) {
      var a = s1s - ia * Math.PI / scount1;
      vertices.push(
        this.v.clone()
        .addScaledVector(b1s, m1s * Math.cos(a))
        .addScaledVector(c1s, n1s * Math.sin(a))
      );
    }

    // build the profiles; each profile is an array of indices into the vertex
    // array, denoting a vertex loop

    // looking into (against) the strut vectors, profiles 0 and 1 are wound CCW,
    // while profile s is wound CW
    // determining orientation: looking down the inward vector with vs pointing
    // down, there are two possibilities for 0/1 (0 on the left and 1 on the
    // right or vice versa), and we can determine which with a cross product;
    // given this, for every profile there will be a left and right arc (looking
    // into the strut vector) and the right arc will wind in reverse order

    // if this is > 0, 0 is on the left; else 1 is on the left
    var dir = ihat.clone().cross(vs).dot(v0);
    if (equal(dir, 0)) dir = -ihat.clone().cross(vs).dot(v1);

    // s strut left and right indices
    var idxsL = dir > 0 ? s0sidx : s1sidx;
    var idxsR = dir > 0 ? s1sidx : s0sidx;
    // 0 strut left and right indices
    var idx0L = dir > 0 ? s0sidx : s01idx;
    var idx0R = dir > 0 ? s01idx : s0sidx;
    // 1 strut left and right indices
    var idx1L = dir > 0 ? s01idx : s1sidx;
    var idx1R = dir > 0 ? s1sidx : s01idx;

    // profile arrays
    var ps = [];
    var p0 = [];
    var p1 = [];

    // write inward verts
    ps.push(inidx);
    p0.push(inidx);
    p1.push(inidx);

    // write left arcs
    for (var ia = 0; ia < scount; ia++) {
      ps.push(idxsL + ia);
      p0.push(idx0L + ia);
      p1.push(idx1L + ia);
    }

    // write outward verts
    ps.push(outidx);
    p0.push(outidx);
    p1.push(outidx);

    // write right arcs
    for (var ia = scount-1; ia >= 0; ia--) {
      ps.push(idxsR + ia);
      p0.push(idx0R + ia);
      p1.push(idx1R + ia);
    }

    // store profiles
    this.ps = ps;
    this.p0 = p0;
    this.p1 = p1;
  }

  if (this.b0) this.b0.makeProfiles(geo, radius, subdivs, spikeFactor);
  if (this.b1) this.b1.makeProfiles(geo, radius, subdivs, spikeFactor);
}

// connect created profiles with geometry
SupportTreeNode.prototype.connectProfiles = function(geo, radius, subdivs, spikeFactor) {
  var vertices = geo.vertices;
  var faces = geo.faces;

  if (this.isRoot()) {
    this.connectToBranch(this.b0, geo, subdivs);
    this.makeSpike(geo, radius, subdivs, spikeFactor);
  }
  else if (this.isLeaf()) {
    this.makeSpike(geo, radius, subdivs, spikeFactor);
  }
  else {
    this.connectToBranch(this.b0, geo, subdivs);
    this.connectToBranch(this.b1, geo, subdivs);
  }

  if (this.b0) this.b0.connectProfiles(geo, radius, subdivs, spikeFactor);
  if (this.b1) this.b1.connectProfiles(geo, radius, subdivs, spikeFactor);

  if (this.isRoot()) debug.lines(12);
}

// connect a node to one of its branch nodes
SupportTreeNode.prototype.connectToBranch = function(n, geo, subdivs) {
  if (!n) return;

  var vertices = geo.vertices;
  var faces = geo.faces;

  // source and target profiles
  var sp = (n === this.b0) ? this.p0 : this.p1;
  var tp = n.ps;

  // unit vector pointing up to other node
  var vn = n.v.clone().sub(this.v).normalize();

  // start index on target profile
  var tidx = 0;
  // maximal dot product between points from source to target
  var maxdot = 0;

  // arbitrary point on source profile
  var spt = vertices[sp[0]];

  // given this point on source profile, find the most closely matching point
  // on target profile
  for (var ii = 0; ii < subdivs; ii++) {
    var vst, dot;

    // unit vector from source point to target point
    vst = vertices[tp[ii]].clone().sub(spt).normalize();

    dot = vst.dot(vn);
    if (dot > maxdot) {
      maxdot = dot;
      tidx = ii;
    }
  }

  for (var ii = 0; ii < subdivs; ii++) {
    var a = tp[(tidx + ii) % subdivs];
    var b = tp[(tidx + ii + 1) % subdivs];
    var c = sp[ii];
    var d = sp[(ii + 1) % subdivs];

    faces.push(new THREE.Face3(a, c, d));
    faces.push(new THREE.Face3(a, d, b));
  }
}

SupportTreeNode.prototype.makeSpike = function(geo, radius, subdivs, spikeFactor) {
  var vertices = geo.vertices;
  var faces = geo.faces;

  var spikeLength = radius * spikeFactor;

  // get the profile and the inverse strut vector
  var p, vn;

  if (this.isRoot()) {
    p = this.p0;
    vn = this.v.clone().sub(this.b0.v).normalize();
  }
  else if (this.isLeaf()) {
    p = this.ps;
    vn = this.v.clone().sub(this.source.v).normalize();
  }
  else return;

  // spike vertex
  var vs = this.v.clone().addScaledVector(vn, spikeLength / 2);

  // record spike vertex
  var sidx = vertices.length;
  vertices.push(vs);

  // index increment (accounts for opposite winding)
  var iincr = this.isRoot() ? subdivs - 1 : 1

  // write faces
  for (var ii = 0; ii < subdivs; ii++) {
    faces.push(new THREE.Face3(sidx, p[ii], p[(ii + iincr) % subdivs]));
  }
}

// for root/leaf nodes, returns how far we can offset a circular profile from
// the node such that it doesn't interfere with the other struts incident on
// this node
SupportTreeNode.prototype.offsetLimit = function(radius) {
  var isRoot = this.isRoot();
  var isLeaf = this.isLeaf();

  // if internal node, return no limit
  if (!(isRoot || isLeaf)) return Infinity;

  // other node connected to this node, and the two nodes connected to that
  var n, a, b;

  // branch node 0 if root; source if leaf
  n = isRoot ? this.b0 : this.s;

  // if node is isolated (shouldn't happen), return 0
  if (!n) return 0;

  // length of the strut
  var l = this.v.distanceTo(n.v);

  // root connects to leaf - can offset by <= half the length of the strut
  if (n.isLeaf()) return l / 2;

  // if root, a and b are the two branch nodes from n
  if (isRoot) {
    a = n.b0;
    b = n.b1;
  }
  // if leaf, a and b are n's other branch and its source
  else {
    a = (this === n.b0) ? b1 : b0;
    b = n.source;
  }

  // unit vectors along the struts
  var vn = this.v.clone().sub(n.v).normalize();
  var va = a.v.clone().sub(n.v).normalize();
  var vb = b.v.clone().sub(n.v).normalize();

  // bisectors between n and its adjoining struts
  var bna = vn.clone().add(va).normalize();
  var bnb = vn.clone().add(vb).normalize();

  // dot products between vn and the bisectors
  var dna = vn.dot(bna);
  var dnb = vn.dot(bnb);

  // failsafe in case either strut is parallel to n strut
  if (equal(dna, 0) || equal(dnb, 0)) return 0;

  // how far each strut's intersection point extends along n strut (from n);
  // equal to radius / tan (acos (vn dot bna)) with
  // tan (acos x) = sqrt (1 - x*x) / x
  var ea = radius * dna / Math.sqrt(1 - dna * dna);
  var eb = radius * dnb / Math.sqrt(1 - dnb * dnb);

  // limit is strut length minus the largest of these two extents
  var limit = l - Math.max(ea, eb);

  return limit;
}
