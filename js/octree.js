// Octree constructor
// params:
//  depth: depth at the root node; child nodes will have smaller depth
//  origin: coords of the corner with the smallest coordinates
//  size: side length; same for all sides
//  scene: optional, used for visualizing the octree
Octree = function(depth, origin, size, scene) {
  this.depth = depth;
  this.origin = origin;
  this.size = size;

  // for visualizing the octree, optional
  this.scene = scene;
  this.density = 0;

  this.node = new TreeNode(depth, origin, size);
}
Octree.prototype.addGeometry = function(faces, vertices) {
  for (var i=0; i<faces.length; i++) {
    var face = faces[i];
    this.node.addFace({
      verts: [vertices[face.a], vertices[face.b], vertices[face.c]],
      normal: face.normal
    },
    i);
  }
  var nLeaves = this.numLeaves()
  console.log(nLeaves, faces.length, faces.length/nLeaves);
}
Octree.prototype.numLeaves = function() {
  return this.node.numLeaves();
}
Octree.prototype.visualize = function() {
  if (!this.scene) return;

  var outlineGeo = new THREE.Geometry();
  this.node.visualize(outlineGeo);
  var outlineMat = new THREE.PointsMaterial({color: 0xff0000, size: 0.03});
  var outlineMesh = new THREE.Points(outlineGeo, outlineMat);
  this.scene.add(outlineMesh);

  var boxGeo = new THREE.Geometry();
  v = [];
  for (var i=0; i<8; i++) {
    v[i] = this.origin.clone();
    v[i].x += this.size*(i&1);
    v[i].y += this.size*(i&2)/2;
    v[i].z += this.size*(i&4)/4;
  }

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
  this.scene.add(boxMesh);
}

TreeNode = function(depth, origin, size) {
  this.depth = depth;
  this.origin = origin;
  this.size = size;

  this.children = [];
}
// params:
//  face: { verts, normal } object; verts is an array of THREE.Vector3s.
//  idx: index to add to a root node if intersecting with the face
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
TreeNode.prototype.visualize = function(geo) {
  if (this.depth==0) {
    var center = this.origin.clone().addScalar(this.size/2);
    geo.vertices.push(center);
  }
  else {
    for (var i=0; i<8; i++) {
      if (this.children[i]!==undefined) {
        this.children[i].visualize(geo);
      }
    }
  }
}

// for testing whether a cross-product was zero
var epsilon = 0.000001;

// return true if cube intersects triangle
// params:
//  o: origin (THREE.Vector3)
//  s: size (float)
//  face: { verts, normal } object; verts is an array of THREE.Vector3s
// references:
// http://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tribox_tam.pdf
// http://fileadmin.cs.lth.se/cs/Personal/Tomas_Akenine-Moller/code/tribox2.txt
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
