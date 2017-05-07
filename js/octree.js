// Octree constructor
// params:
//  depth: depth at the root node; child nodes will have smaller depth
//  origin: coords of the corner with the smallest coordinates
//  size: side length; same for all sides
//  scene: optional, used for visualizing the octree
Octree = function(depth, origin, size, faces, vertices, scene) {
  this.depth = depth;
  this.origin = origin;
  this.size = size;

  if (!faces || !vertices) return;

  this.faces = faces;
  this.vertices = vertices;

  this.node = new TreeNode(depth, origin, size);

  // add geometry
  for (var i=0; i<faces.length; i++) {
    var face = faces[i];
    this.node.addFace({
      verts: [vertices[face.a], vertices[face.b], vertices[face.c]],
      normal: face.normal
    },
    i);
  }

  // for visualizing the octree, optional
  this.scene = scene;
  this.density = 0;
}

Octree.prototype.numLeaves = function() {
  return this.node.numLeaves();
}

// return the distance traveled by the ray before it hits a face that has a
// normal with a positive component along the ray direction
// params:
//  p: ray origin (THREE.Vector3)
//  d: ray direction, assumed normalized (THREE.Vector3)
//  faces, vertices: need these to get geometry for intersection testing
// (variable names are as per the convention of "An efficient Parametric
// Algorithm for Octree Traversal")
Octree.prototype.castRay = function(p, d, faces, vertices) {
  return this.node.castRay(p, d, faces, vertices);
}

Octree.prototype.visualize = function(drawLines, depthLimit) {
  if (!this.scene) return;

  var outlineGeo = new THREE.Geometry();
  this.node.visualize(outlineGeo, drawLines, depthLimit);
  // if drawLines, then outline child nodes with lines; else, draw a point in
  // each one's center
  if (drawLines) {
    var outlineMat = new THREE.LineBasicMaterial({color: 0xff0000});
    var outlineMesh = new THREE.LineSegments(outlineGeo, outlineMat);
  }
  else {
    var outlineMat = new THREE.PointsMaterial({color: 0xff0000, size: 0.03});
    var outlineMesh = new THREE.Points(outlineGeo, outlineMat);
  }
  outlineMesh.name = "octree";
  this.scene.add(outlineMesh);

  var boxGeo = new THREE.Geometry();
  v = this.node.nodeVertices();

  boxGeo.vertices.push(v[0]); boxGeo.vertices.push(v[1]);
  boxGeo.vertices.push(v[2]); boxGeo.vertices.push(v[3]);
  boxGeo.vertices.push(v[4]); boxGeo.vertices.push(v[5]);
  boxGeo.vertices.push(v[6]); boxGeo.vertices.push(v[7]);

  boxGeo.vertices.push(v[0]); boxGeo.vertices.push(v[2]);
  boxGeo.vertices.push(v[1]); boxGeo.vertices.push(v[3]);
  boxGeo.vertices.push(v[4]); boxGeo.vertices.push(v[6]);
  boxGeo.vertices.push(v[5]); boxGeo.vertices.push(v[7]);

  boxGeo.vertices.push(v[0]); boxGeo.vertices.push(v[4]);
  boxGeo.vertices.push(v[1]); boxGeo.vertices.push(v[5]);
  boxGeo.vertices.push(v[2]); boxGeo.vertices.push(v[6]);
  boxGeo.vertices.push(v[3]); boxGeo.vertices.push(v[7]);

  var boxMat = new THREE.LineBasicMaterial({color: 0xff0000});
  var boxMesh = new THREE.LineSegments(boxGeo, boxMat);
  boxMesh.name = "octree";
  this.scene.add(boxMesh);
}

Octree.prototype.calculateEdgeIntersections = function() {
  this.node.calculateEdgeIntersections(this.faces, this.vertices);
}

Octree.prototype.visualizeBorderEdges = function() {
  if (!this.scene) return;

  var borderGeo = new THREE.Geometry();
  this.node.visualizeBorderEdges(borderGeo);
  var borderMat = new THREE.LineBasicMaterial({color: 0x00ff00});
  var borderMesh = new THREE.LineSegments(borderGeo, borderMat);
  this.scene.add(borderMesh);
}


// TreeNode constructor
// params:
//  depth: depth at the current node; child nodes will have smaller depth
//  origin: coords of the corner with the smallest coordinates
//  size: side length; same for all sides
TreeNode = function(depth, origin, size) {
  this.depth = depth;
  this.origin = origin;
  this.size = size;

  this.children = [];
}

// params:
//  face: { verts, normal } object; verts is an array of THREE.Vector3s.
//  idx: index to add to a root node if intersecting with the face
// cell numbering convention:
//  cells are indexed by three bits 0-7; bit 0 is x, bit 1 is y, bit 2 is z
TreeNode.prototype.addFace = function(face, idx) {
  var depth = this.depth;
  if (depth==0) {
    this.children.push(idx);
    return;
  }
  var co, cs;
  for (var i=0; i<8; i++) {
    var child = this.children[i];
    if (child===undefined) {
      // child size
      cs = this.size / 2.0;
      // child origin
      co = this.origin.clone();
      co.x += cs*(i&1);
      co.y += cs*(i&2)/2;
      co.z += cs*(i&4)/4;
    }
    else {
      cs = child.size;
      co = child.origin;
    }

    if (cubeIntersectsTri(co, cs, face)) {
      if (child===undefined) this.children[i] = new TreeNode(depth-1, co, cs);
      this.children[i].addFace(face, idx);
    }
  }
}

TreeNode.prototype.edgeIndices = [
  [0,1], [2,3], [4,5], [6,7], // x-aligned
  [0,2], [1,3], [4,6], [5,7], // y-aligned
  [0,4], [1,5], [2,6], [3,7]  // z-aligned
];
// faces are labeled with normal axis; "far" faces have a larger coordinate on
// the axis than "near" faces
TreeNode.prototype.faceEdgeIndices = [
  [0,2,8,9],   // x, near
  [1,3,10,11], // x, far
  [0,1,4,5],   // y, near
  [2,3,6,7],   // y, far
  [4,6,8,10],  // z, near
  [5,7,9,11]   // z, far
];
TreeNode.prototype.nodeVertices = function() {
  // cube vertices
  v = [];
  for (var i=0; i<8; i++) {
    v[i] = this.origin.clone();
    v[i].x += this.size*(i&1);
    v[i].y += this.size*(i&2)/2;
    v[i].z += this.size*(i&4)/4;
  }
  return v;
}
// convert axis to a node-signifying bit as per our numbering convention (see
// above)
TreeNode.prototype.axisToBit = function(axis) {
  return axis=='x' ? 1 : (axis=='y' ? 2 : 4);
}

// return the distance traveled by the ray before it hits a face that has a
// normal with a positive component along the ray direction
// params:
//  p: ray origin (THREE.Vector3)
//  d: ray direction, assumed normalized (THREE.Vector3)
//  vertices: vertex array; need this to get vertices out of a face
// (variable names are as per the convention of "An Efficient Parametric
// Algorithm for Octree Traversal")
TreeNode.prototype.castRay = function(p, d, faces, vertices) {
  // get the enter and exit t parameters for the root node
  var t0 = this.origin.clone().sub(p).divide(d);
  var t1 = this.origin.clone().addScalar(this.size).sub(p).divide(d);
  // 1 if d is increasing along an axis; else, -1
  var dir = new THREE.Vector3(Math.sign(d.x), Math.sign(d.y), Math.sign(d.z));
  // swap t0 and t1 values for the axes on which the ray is decreasing
  if (dir.x<0) {
    var tmp = t0.x;
    t0.x = t1.x;
    t1.x = tmp;
  }
  if (dir.y<0) {
    var tmp = t0.y;
    t0.y = t1.y;
    t1.y = tmp;
  }
  if (dir.z<0) {
    var tmp = t0.z;
    t0.z = t1.z;
    t1.z = tmp;
  }

  // get the point where the ray exits the far end of the root node
  var rayEnd = p.clone().add(d.clone().multiplyScalar(vector3Min(t1)));

  // intersection-checking function to be passed to the ray-casting process:
  // if the ray intersects the given face, return the distance from the ray
  // origin to the intersection point; else, return 0
  var rayHitDist = function(faceIdx) {
    var face = faces[faceIdx];
    // normal must have positive component along d
    if (face.normal.dot(d)<=0) return 0;

    // if correct normal, test intersection
    var v1 = vertices[face.a];
    var v2 = vertices[face.b];
    var v3 = vertices[face.c];

    // get the intersection of the face with the ray
    var intersection = triSegmentIntersection(v1, v2, v3, p, rayEnd);

    // if intersection exists, compute distance from ray source and return;
    // else, return 0
    if (intersection) return p.distanceTo(intersection);
    else return 0;
  }

  // cast the ray and get the distance at which it hits
  var dist = this.castRayProc(t0, t1, dir, rayHitDist);

  return {t0: t0, t1: t1, s: p, e: rayEnd, dist: dist};
}

// returns the distane from the ray origin to the closest face it hits
TreeNode.prototype.castRayProc = function(t0, t1, dir, rayHitDist) {
  var _this = this;

  // if at a leaf node
  if (this.depth==0) {
    for (var i=0; i<this.children.length; i++) {
      // check for intersection between a face and the ray
      var faceIdx = this.children[i];

      // get the distance to the face
      // note that there may be multiple suitable faces in the node, but the
      // impact of only taking the first one should be negligible
      var dist = rayHitDist(faceIdx);
      if (dist>0) return dist;
    }

    return 0;
  }
  // if not at a leaf node, need to propagate the ray intersection testing to
  // each child node the ray crosses (in the order it crosses them)
  else {
    // t at the middle of the node
    var tm = t0.clone().add(t1).divideScalar(2.0);

    // find the node among the eight children which the ray enters first

    // first child index
    var currentChildIdx = 0;
    // if decreasing along an axis, the node will be hit from the far side on
    // that axis
    if (dir.x<0) currentChildIdx += 1;
    if (dir.y<0) currentChildIdx += 2;
    if (dir.z<0) currentChildIdx += 4;
    // axis normal to the plane on which the ray enters the node ('x', etc.)
    var axis = vector3ArgMax(t0);
    // given an entry plane, four candidate children may be crossed first; use
    // the t values at entry and at middle to figure out the correct child
    if (axis=='x') {
      if (tm.y<t0.x) currentChildIdx += dir.y*2;
      if (tm.z<t0.x) currentChildIdx += dir.z*4;
    }
    else if (axis=='y') {
      if (tm.x<t0.y) currentChildIdx += dir.x;
      if (tm.z<t0.y) currentChildIdx += dir.z*4;
    }
    else if (axis=='z') {
      if (tm.x<t0.z) currentChildIdx += dir.x;
      if (tm.y<t0.z) currentChildIdx += dir.y*2;
    }

    // walk through the current node, recursing on the child nodes in the
    // order the ray hits them
    while (currentChildIdx>-1) {
      var child = this.children[currentChildIdx];
      var childParams = getNodeParams(currentChildIdx, t0, tm, t1, dir);

      //console.log(this.depth, currentChildIdx, vector3ArgMax(childParams.t0), vector3ArgMin(childParams.t1), !!child);
      // child node may be undefined; if so, skip recursion and go to next child
      if (child) {
        var dist = child.castRayProc(childParams.t0, childParams.t1, dir, rayHitDist);
        // a child node has returned a collision, so return this
        if (dist>0) return dist;
      }

      currentChildIdx = getNextChild(currentChildIdx, childParams.t1, dir);
    }
  }

  return 0;


  // node traversal functions

  // get the params of a node given its parent params
  function getNodeParams(idx, t0, tm, t1, dir) {
    // make a new pair of vectors to hold the new bounds
    var t0c = t0.clone();
    var t1c = t1.clone();

    var xmask = 1&idx;
    var ymask = 2&idx;
    var zmask = 4&idx;
    // check if the child is far or near on an asix from the ray origin
    var xnear = (!xmask && dir.x>0) || (xmask && dir.x<0);
    var ynear = (!ymask && dir.y>0) || (ymask && dir.y<0);
    var znear = (!zmask && dir.z>0) || (zmask && dir.z<0);

    // if child is near on an axis, move t1 down to the middle;
    // if child is far on an axis, move t0 up to the middle
    if (xnear) t1c.x = tm.x;
    else t0c.x = tm.x;
    if (ynear) t1c.y = tm.y;
    else t0c.y = tm.y;
    if (znear) t1c.z = tm.z;
    else t0c.z = tm.z;

    return { t0: t0c, t1: t1c };
  }

  // given a child we know we've visited, get the next child
  function getNextChild(idx, t1, dir) {
    // axis normal to the plane through which the ray exits the node
    var exitAxis = vector3ArgMin(t1);

    var xmask = 1&idx;
    var ymask = 2&idx;
    var zmask = 4&idx;
    // bits signifying whether we're in a near node (hit by the ray sooner) or
    // in a far node
    var xnear = (!xmask && dir.x>0) || (xmask && dir.x<0);
    var ynear = (!ymask && dir.y>0) || (ymask && dir.y<0);
    var znear = (!zmask && dir.z>0) || (zmask && dir.z<0);

    // can only advance to another child if we're in a near node on an axis and
    // the exit face is to the far node on the same axis
    if (xnear && exitAxis=='x') return idx + dir.x;
    if (ynear && exitAxis=='y') return idx + dir.y*2;
    if (znear && exitAxis=='z') return idx + dir.z*4;

    // if can't advance, return -1
    return -1;
  }
}

// store a mask in each leaf node that indicates edge intersections
// params:
//  faces, vertices: pass these in to convert face indices to faces to vertices
TreeNode.prototype.calculateEdgeIntersections = function(faces, vertices) {
  if (!faces || !vertices) return;

  var depth = this.depth;
  if (depth==0) {
    var edgeMask = 0;

    var s = this.nodeVertices();
    for (var i=0; i<this.children.length; i++) {
      var face = faces[this.children[i]];
      var v1 = vertices[face.a];
      var v2 = vertices[face.b];
      var v3 = vertices[face.c];
      // walk through the edges of the node
      // get edge vertices from the LUT (this.edgeIndices)
      for (var j=0; j<12; j++) {
        var edgeIndices = this.edgeIndices[j];
        var s1 = s[edgeIndices[0]];
        var s2 = s[edgeIndices[1]];


        // if tri intersects a given edge, flip the corresponding edgeMask bit;
        // a set bit corresponds to an edge that has an odd number of triangle
        // intersections
        if (triSegmentIntersection(v1, v2, v3, s1, s2)) {
          edgeMask ^= 1<<j;
        }
      }
    }
    this.edgeMask = edgeMask;
  }
  else {
    for (var i=0; i<8; i++) {
      var child = this.children[i];
      if (child!==undefined) child.calculateEdgeIntersections(faces, vertices);
    }
  }
}

// return the total number of leaf nodes in the node
TreeNode.prototype.numLeaves = function() {
  if (this.depth==0) {
    return 1;
  }
  else {
    var total = 0;
    for (var i=0; i<8; i++) {
      var child = this.children[i];
      if (child!==undefined) total += child.numLeaves();
    }
    return total;
  }
}

TreeNode.prototype.visualize = function(geo, drawLines, depthLimit) {

  if (this.depth==0 || (depthLimit!==undefined && this.depth==depthLimit)) {
    if (drawLines) {
      var v = this.nodeVertices();

      geo.vertices.push(v[0]); geo.vertices.push(v[1]);
      geo.vertices.push(v[2]); geo.vertices.push(v[3]);
      geo.vertices.push(v[4]); geo.vertices.push(v[5]);
      geo.vertices.push(v[6]); geo.vertices.push(v[7]);

      geo.vertices.push(v[0]); geo.vertices.push(v[2]);
      geo.vertices.push(v[1]); geo.vertices.push(v[3]);
      geo.vertices.push(v[4]); geo.vertices.push(v[6]);
      geo.vertices.push(v[5]); geo.vertices.push(v[7]);

      geo.vertices.push(v[0]); geo.vertices.push(v[4]);
      geo.vertices.push(v[1]); geo.vertices.push(v[5]);
      geo.vertices.push(v[2]); geo.vertices.push(v[6]);
      geo.vertices.push(v[3]); geo.vertices.push(v[7]);
    }
    else {
      var center = this.origin.clone().addScalar(this.size/2);
      geo.vertices.push(center);
    }
  }
  else {
    for (var i=0; i<8; i++) {
      var child = this.children[i];
      if (child!==undefined) {
        child.visualize(geo, drawLines, depthLimit);
      }
    }
  }
}

TreeNode.prototype.visualizeBorderEdges = function(geo) {
  if (this.depth==0) {
    if (!this.edgeMask) return;
    var v = this.nodeVertices();

    // walk through all 6 faces
    for (var i=0; i<6; i++) {
      var edges = this.faceEdgeIndices[i];

      // test if total number of intersections on face is even or odd
      var total = 0;
      for (var j=0; j<4; j++) {
         total += (this.edgeMask&(1<<edges[j]))>>edges[j];
      }

      // if face has an odd number of intersections, show it
      if (total&1 != 0) {
        for (var j=0; j<4; j++) {
          var edgeIndices = this.edgeIndices[edges[j]];
          geo.vertices.push(v[edgeIndices[0]]);
          geo.vertices.push(v[edgeIndices[1]]);
        }
      }
    }
  }
  else {
    for (var i=0; i<8; i++) {
      var child = this.children[i];
      if (child!==undefined) {
        child.visualizeBorderEdges(geo);
      }
    }
  }
}

// return true if cube intersects triangle
// uses the standard 13 SAT intersection tests
// params:
//  o: origin (THREE.Vector3)
//  s: size (float)
//  face: { verts, normal } object; verts is an array of THREE.Vector3s
// references:
//  http://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tribox_tam.pdf
//  http://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tribox2.txt
function cubeIntersectsTri(o, s, face) {
  var v0 = face.verts[0], v1 = face.verts[1], v2 = face.verts[2];
  var min, max;

  // test 1 - minimum along axes
  // simplest and likeliest to fail
  min = Math.min(v0.x, v1.x, v2.x);
  max = Math.max(v0.x, v1.x, v2.x);
  if (max<o.x || min>o.x+s) return false;
  min = Math.min(v0.y, v1.y, v2.y);
  max = Math.max(v0.y, v1.y, v2.y);
  if (max<o.y || min>o.y+s) return false;
  min = Math.min(v0.z, v1.z, v2.z);
  max = Math.max(v0.z, v1.z, v2.z);
  if (max<o.z || min>o.z+s) return false;

  // test 2 - plane coplanar with face
  // fairly likely to fail
  if (!cubeIntersectsPlane(o, s, face.verts[0], face.normal)) return false;

  // test 3 - cross products of edges
  // f0/1/2 are the edges of the face
  var f0 = new THREE.Vector3().subVectors(v1, v0);
  var f1 = new THREE.Vector3().subVectors(v2, v1);
  var f2 = new THREE.Vector3().subVectors(v0, v2);

  for (var axis=0; axis<3; axis++) {
    // cross axis with the edges
    if (!axisCrossEdgeIntersection(o, s, axis, f0, v0, v2)) return false;
    if (!axisCrossEdgeIntersection(o, s, axis, f1, v1, v0)) return false;
    if (!axisCrossEdgeIntersection(o, s, axis, f2, v2, v1)) return false;
  }

  return true;
}

// return false if cube and plane are separated by a plane normal to the
// cross-product of the given axis and the given vector
// params:
//  o, s: origin and size of cube
//  axisIdx: axis index to produce cross-product; 0 for x, 1 for y, 2 for z
//  f: edge to cross-product
//  va, vb: one vertex of the triangle on the edge, the other not on the edge;
//          e.g., if f=v1-v0, then va = v0 (or v2), vb = v2
function axisCrossEdgeIntersection(o, s, axisIdx, f, va, vb) {
  var pa, pb, min, max, vp, vmin=Infinity, vmax=-Infinity;
  var c = new THREE.Vector3();

  var epsilon = 0.000001;
  // if x-axis and only proceed if v is not aligned with x
  if (axisIdx==0 && (f.z*f.z + f.y*f.y)>epsilon) {
    // get testing axis; cross-product with axes is known in advance, so write
    // out without calculating
    c.set(0, -f.z, f.y);
    // project triangle onto testing axis
    // only need to calculate with two vertices because two of them will have
    // the same projection b/c they form the input edge f
    pa = c.dot(va), pb = c.dot(vb);
    if (pa>pb) { min = pb; max = pa; }
    else { min = pa; max = pb; }
    // project cube onto testing axis - only y and z corners b/c axis is normal to x
    for (var yi=0; yi<2; yi++) {
      for (var zi=0; zi<2; zi++) {
        vp = (o.y+s*yi)*c.y + (o.z+s*zi)*c.z;
        if (vp<vmin) vmin=vp;
        if (vp>vmax) vmax=vp;
      }
    }
    if (min>vmax || max<vmin) return false;
  }
  else if (axisIdx==1 && (f.z*f.z + f.x*f.x)>epsilon) {
    c.set(f.z, 0, -f.x);
    pa = c.dot(va), pb = c.dot(vb);
    if (pa>pb) { min = pb; max = pa; }
    else { min = pa; max = pb; }
    for (var xi=0; xi<2; xi++) {
      for (var zi=0; zi<2; zi++) {
        vp = (o.x+s*xi)*c.x + (o.z+s*zi)*c.z;
        if (vp<vmin) vmin=vp;
        if (vp>vmax) vmax=vp;
      }
    }
    if (min>vmax || max<vmin) return false;
  }
  else if (axisIdx==2 && (f.y*f.y + f.x*f.x)>epsilon) {
    c.set(-f.y, f.x, 0);
    pa = c.dot(va), pb = c.dot(vb);
    if (pa>pb) { min = pb; max = pa; }
    else { min = pa; max = pb; }
    for (var xi=0; xi<2; xi++) {
      for (var yi=0; yi<2; yi++) {
        vp = (o.x+s*xi)*c.x + (o.y+s*yi)*c.y;
        if (vp<vmin) vmin=vp;
        if (vp>vmax) vmax=vp;
      }
    }
    if (min>vmax || max<vmin) return false;
  }

  return true;
}

// return true if cube intersects plane given by a vertex and a normal
// params:
//  o, s: origin and size of cube
//  v, n: vertex on plane, normal of plane
function cubeIntersectsPlane(o, s, v, n) {
  var vmin = new THREE.Vector3().subVectors(o, v);
  var vmax = new THREE.Vector3().subVectors(o, v);

  // if normal.x positive, vmax.x is greater than vmin.x; else vmin.x greater.
  // etc. for y and z
  if (n.x>0.0) vmax.x += s;
  else vmin.x += s;
  if (n.y>0.0) vmax.y += s;
  else vmin.y += s;
  if (n.z>0.0) vmax.z += s;
  else vmin.z += s;

  if (n.dot(vmin)>0.0) return false;
  if (n.dot(vmax)>0.0) return true;

  return false;
}

// return intersection point if tri intersects line segment (two vertices), else
// return null;
// no easy way to explain how it works - look up the Moller-Trumbore algorithm
// params:
//  v1, v2, v3: tri vertices
//  s1, s2: segment vertices
function triSegmentIntersection(v1, v2, v3, s1, s2) {
  var epsilon = 0.000001;
  // "ray" origin is implicitly s1; "ray" direction is s2-s1
  var D = s2.clone().sub(s1);
  var L = D.length();
  // if line segment endpoints are the same, return b/c bad input
  if (L < epsilon) return null;
  // normalize "ray" direction
  D.divideScalar(L);
  // two edges of tri sharing v1
  var e1 = v2.clone().sub(v1);
  var e2 = v3.clone().sub(v1);

  var P = D.clone().cross(e2);

  var det = e1.dot(P);
  // if determinant is 0, segment is parallel to tri, so no intersection
  if (det > -epsilon && det < epsilon) return null;
  var inv_det = 1.0/det;

  // test u parameter
  var T = s1.clone().sub(v1);
  var u = T.dot(P) * inv_det;
  // if intersection, u (see the MT paper) is between 0 and 1
  if (u < 0.0 || u > 1.0) return null;

  // test v parameter
  var Q = T.cross(e1);
  var v = D.dot(Q) * inv_det;
  // like u, v is nonnegative and u+v <= 1
  if (v < 0.0 || u+v > 1.0) return null;

  // test t parameter; has to be positive and not farther from s1 than s2
  var t = e2.dot(Q) * inv_det;
  if (t > 0.0 && t < L) return s1.clone().add(D.clone().multiplyScalar(t));

  return null;
}
