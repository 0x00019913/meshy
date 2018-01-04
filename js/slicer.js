/* slicer.js */

var scene; // for debugging, todo: remove
var debugGeo = new THREE.Geometry();

Slicer = function(sourceVertices, sourceFaces, params) {
  this.sourceVertices = sourceVertices;
  this.sourceFaces = sourceFaces;
  this.sourceVertexCount = sourceVertices.length;
  this.sourceFaceCount = sourceFaces.length;

  this.previewVertices = null;
  this.previewFaces = null;

  this.pathVertices = null;

  this.sliceHeight = 0.5;
  this.axis = "z";
  this.mode = "preview";
  this.previewGeometryReady = false;
  this.pathGeometryReady = false;

  // set from params
  if (params) {
    if (params.hasOwnProperty("sliceHeight")) this.sliceHeight = params.sliceHeight;
    if (params.hasOwnProperty("axis")) this.axis = params.axis;
    if (params.hasOwnProperty("mode")) this.mode = params.mode;
    if (params.hasOwnProperty("scene")) this.scene = params.scene;
  }

  // for debugging, todo: remove
  scene = this.scene;

  // 1. assume right-handed coords
  // 2. look along negative this.axis with the other axes pointing up and right
  // then this.axish points right and this.axisv points up
  this.axish = cycleAxis(this.axis);
  this.axisv = cycleAxis(this.axish);

  this.calculateFaceBounds();

  this.setMode(this.mode);
}

// necessary function - called from constructor
// calculates min and max for every face on the axis
Slicer.prototype.calculateFaceBounds = function() {
  this.faceBounds = [];
  var faceBounds = this.faceBounds;
  var min = Infinity, max = -Infinity;

  for (var i=0; i<this.sourceFaces.length; i++) {
    var face = this.sourceFaces[i];
    var bounds = faceGetBounds(face, this.axis, this.sourceVertices);

    max = Math.max(max, bounds.max);
    min = Math.min(min, bounds.min);

    // store min and max for each face
    faceBounds.push({
      face: face.clone(),
      max: bounds.max,
      min: bounds.min
    });
  }

  this.min = min;
  this.max = max;
  // first slice is half a slice height below mesh min, hence +1
  this.numSlices = Math.floor(0.5 + (max - min) / this.sliceHeight) + 2;
  this.currentSlice = this.numSlices;
}

Slicer.prototype.setMode = function(mode) {
  this.mode = mode;

  if (mode=="preview") {
    if (!this.previewGeometryReady) this.makePreviewGeometry();
  }
  else if (this.mode=="path") {
    if (!this.pathGeometryReady) this.makePathGeometry();
  }

  this.setSlice(this.currentSlice);
}

Slicer.prototype.getMode = function() {
  return this.mode;
}

Slicer.prototype.getGeometry = function() {
  if (this.mode=="preview") return {
    vertices: this.previewVertices,
    faces: this.previewFaces
  };
  else if (this.mode=="path") return {
    vertices: this.pathVertices,
    faces: null
  };
}

Slicer.prototype.getNumSlices = function() {
  return this.numSlices;
}

Slicer.prototype.getCurrentSlice = function() {
  return this.currentSlice;
}

Slicer.prototype.setSlice = function(slice) {
  this.currentSlice = slice;
  if (this.mode=="preview") this.setPreviewSlice();
  else if (this.mode=="path") this.setPathSlice();
}

Slicer.prototype.setPreviewSlice = function() {
  var slice = this.currentSlice;

  var sliceLevel = this.min + (slice-0.5) * this.sliceHeight;
  var faceBounds = this.faceBounds;

  // array of faces that intersect the slicing plane
  var slicedFaces = [];

  for (var i = this.sourceFaceCount-1; i >= 0; i--) {
    var bounds = faceBounds[i];
    // if min above slice level, need to hide the face
    if (bounds.min > sliceLevel) bounds.face.materialIndex = 1;
    // else min <= slice level
    else {
      // if max below slice level, need to show the face
      if (bounds.max < sliceLevel) bounds.face.materialIndex = 0;
      // else, face is cut
      else {
        bounds.face.materialIndex = 1;
        slicedFaces.push(bounds.face);
      }
    }
  }

  // handle the sliced faces: slice them and insert them (and associated verts)
  // into previewMesh

  // current vertices and faces
  var vertices = this.previewVertices;
  var faces = this.previewFaces;
  // local vars for ease of access
  var vertexCount = this.sourceVertexCount;
  var faceCount = this.sourceFaceCount;
  // erase any sliced verts and faces
  vertices.length = vertexCount;
  faces.length = faceCount;

  var axis = this.axis;

  // newly created verts and faces will go here; then append them to the mesh;
  // max of 2 times that many faces and 4 times that many verts
  var newVertices = new Array(4 * slicedFaces.length);
  var newFaces = new Array(2 * slicedFaces.length);
  // current face/vertex in the new arrays
  var vidx = 0;
  var fidx = 0;

  var sliceBuilder = new SliceBuilder(axis);

  // slice the faces
  for (var f = 0; f < slicedFaces.length; f++) {
    var slicedFace = slicedFaces[f];

    // in the following, A is the bottom vert, B is the middle vert, and XY
    // are the points there the triangle intersects the X-Y segment

    // get verts sorted on axis; check if this flipped winding order (default is CCW)
    var vertsSorted = faceGetVertsSorted(slicedFace, vertices, axis);
    var [A, B, C] = vertsSorted.verts;
    var ccw = vertsSorted.ccw;

    // if middle vert is greater than slice level, slice into 1 triangle A-AB-AC
    if (B[axis] > sliceLevel) {
      // calculate intersection of A-B and A-C
      var AB = segmentPlaneIntersection(axis, sliceLevel, A, B);
      var AC = segmentPlaneIntersection(axis, sliceLevel, A, C);

      // get indices of these verts in the final vert array before pushing them there
      var idxA = vertexCount + vidx;
      var idxAB = idxA + 1;
      var idxAC = idxA + 2;
      newVertices[vidx++] = A;
      newVertices[vidx++] = AB;
      newVertices[vidx++] = AC;

      // create the new face and push it into the faces array
      var newFace;
      if (ccw) {
        newFace = new THREE.Face3(idxA, idxAB, idxAC);
        newFace.normal.copy(vertsComputeNormal(A, AB, AC));
      }
      else {
        newFace = new THREE.Face3(idxA, idxAC, idxAB);
        newFace.normal.copy(vertsComputeNormal(A, AC, AB));
      }
      // explicitly visible
      newFace.materialIndex = 0;

      newFaces[fidx++] = newFace;

      sliceBuilder.addSegment(AB, AC, newFace.normal, idxAB, idxAC);
    }
    // else, slice into two triangles: A-B-AC and B-BC-AC
    else {
      // calculate intersection of A-C and B-C
      var AC = segmentPlaneIntersection(axis, sliceLevel, A, C);
      var BC = segmentPlaneIntersection(axis, sliceLevel, B, C);
      // get indices of these verts in the vert array before pushing them there
      var idxA = vertexCount + vidx;
      var idxB = idxA + 1;
      var idxAC = idxA + 2;
      var idxBC = idxA + 3;
      newVertices[vidx++] = A;
      newVertices[vidx++] = B;
      newVertices[vidx++] = AC;
      newVertices[vidx++] = BC;

      // create the new faces and push it into the faces array
      var newFace1, newFace2;
      if (ccw) {
        newFace1 = new THREE.Face3(idxA, idxB, idxAC);
        newFace2 = new THREE.Face3(idxB, idxBC, idxAC);
        newFace1.normal.copy(vertsComputeNormal(A, B, AC));
        newFace2.normal.copy(vertsComputeNormal(B, BC, AC));
      }
      else {
        newFace1 = new THREE.Face3(idxA, idxAC, idxB);
        newFace2 = new THREE.Face3(idxB, idxAC, idxBC);
        newFace1.normal.copy(vertsComputeNormal(A, AC, B));
        newFace2.normal.copy(vertsComputeNormal(B, AC, BC));
      }
      // explicitly visible
      newFace1.materialIndex = 0;
      newFace2.materialIndex = 0;

      newFaces[fidx++] = newFace1;
      newFaces[fidx++] = newFace2;

      sliceBuilder.addSegment(AC, BC, newFace2.normal, idxAC, idxBC);
    }
  }

  // put the new verts and faces on the end of the existing array
  this.previewVertices = vertices.concat(newVertices);
  this.previewFaces = faces.concat(newFaces);

  // erase whatever we allocated and didn't need
  this.previewVertices.length = vertexCount + vidx;
  this.previewFaces.length = faceCount + fidx;

  var slice = sliceBuilder.getSlice();
  var triIndices = slice.triangulate();

  var triFaces = [];

  for (var i=0; i<triIndices.length; i += 3) {
    var face = new THREE.Face3(triIndices[i], triIndices[i+1], triIndices[i+2]);
    faceComputeNormal(face, this.previewVertices);
    face.materialIndex = 2;
    triFaces.push(face);
  }

  this.previewFaces = this.previewFaces.concat(triFaces);
}

Slicer.prototype.setPathSlice = function() {
  var slice = this.currentSlice;
  // todo
}

Slicer.prototype.makePreviewGeometry = function() {
  this.previewVertices = this.sourceVertices.slice();
  this.previewFaces = [];

  // set the face array on the mesh
  for (var i=0; i<this.faceBounds.length; i++) {
    var face = this.faceBounds[i].face;
    face.materialIndex = 0; // explicitly set as visible by default
    this.previewFaces.push(face);
  }

  this.previewGeometryReady = true;
}

Slicer.prototype.makePathGeometry = function() {
  var segmentLists = this.buildLayerSegmentLists();

  this.pathVertices = [];

  for (var i=0; i<segmentLists.length; i++) {
    var segmentList = segmentLists[i];
    for (var s=0; s<segmentList.length; s++) {
      var segment = segmentList[s];
      this.pathVertices.push(segment[0]);
      this.pathVertices.push(segment[1]);
    }
  }

  this.pathGeometryReady = true;
}



// SLICING THE MESH INTO PATHS

// uses an implementation of "An Optimal Algorithm for 3D Triangle Mesh Slicing"
// http://www.dainf.ct.utfpr.edu.br/~murilo/public/CAD-slicing.pdf

Slicer.prototype.buildLayerLists = function() {
  var sliceHeight = this.sliceHeight;
  var min = this.min, max = this.max;
  var faceBounds = this.faceBounds;

  var numPathLayers = this.numSlices - 2;

  // position fo first and last layer
  var layer0 = min + sliceHeight/2;
  var layerk = layer0 + sliceHeight * (numPathLayers - 1);

  // init layer lists
  var layerLists = new Array(numPathLayers + 1);
  for (var i=0; i<=numPathLayers; i++) layerLists[i] = [];

  // bucket the faces
  for (var i=0; i<this.sourceFaceCount; i++) {
    var bounds = faceBounds[i];
    var index;

    if (bounds.min < layer0) index = 0;
    else if (bounds.min > layerk) index = numPathLayers;
    else index = Math.ceil((bounds.min - layer0) / sliceHeight);

    layerLists[index].push(i);
  }

  return layerLists;
}

Slicer.prototype.buildLayerSegmentLists = function() {
  var layerLists = this.buildLayerLists();

  // various local vars
  var numPathLayers = layerLists.length;
  var faceBounds = this.faceBounds;
  var min = this.min, axis = this.axis;
  var sliceHeight = this.sliceHeight;
  var vertices = this.sourceVertices;
  var faces = this.sourceFaces;

  var layerSegmentLists = new Array(numPathLayers);

  // running set of active face indices as we sweep up along the layers
  var sweepSet = new Set();

  for (var i=0; i<numPathLayers; i++) {
    // reaching a new layer, insert whatever new active face indices for that layer
    if (layerLists[i].length>0) sweepSet = new Set([...sweepSet, ...layerLists[i]]);

    // accumulate these for this layer
    var layerSegmentList = [];
    // height of layer from mesh min
    var sliceLevel = min + (i + 0.5) * sliceHeight;

    // for each index in the sweep list, see if it intersects the slicing plane:
    //  if it's below the slicing plane, eliminate it
    //  else, store its intersection with the slicing plane
    for (var idx of sweepSet) {
      var bounds = faceBounds[idx];

      if (bounds.max < sliceLevel) sweepSet.delete(idx);
      else {
        // get verts sorted in ascending order on axis; call it [A,B,C]
        var verts = faceGetVertsSorted(bounds.face, vertices, axis).verts;
        var a0 = verts[0][axis];
        var a1 = verts[1][axis];
        var a2 = verts[2][axis];

        // face is flat or intersects slicing plane at a point
        if (a0 == a2) continue;
        if (a0 == sliceLevel && a0 < a1) continue;
        if (a2 == sliceLevel && a1 < a2) continue;

        // if B is above slicing plane, calculate AB and AC intersection
        if (a1 > sliceLevel) {
          var int1 = segmentPlaneIntersection(axis, sliceLevel, verts[0], verts[1]);
        }
        // else, calculate BC and AC intersection
        else {
          var int1 = segmentPlaneIntersection(axis, sliceLevel, verts[1], verts[2]);
        }
        var int2 = segmentPlaneIntersection(axis, sliceLevel, verts[0], verts[2]);

        layerSegmentList.push([int1, int2]);
      }
    }

    layerSegmentLists[i] = layerSegmentList;
  }

  return layerSegmentLists;
}

Slice = function(polys) {
  this.polys = polys;
}

Slice.prototype.triangulate = function() {
  // polys is an array of edgeloops signifying every polygon in the slice
  var polys = this.polys;
  var indices = [];

  for (var i=0; i<polys.length; i++) {
    indices = indices.concat(polys[i].triangulate());
  }
  // todo: remove
  if (polys.length>0) debug();

  return indices;
}

// circular double-linked list symbolizing an edge loop
EdgeLoop = function(axis, vertices, indices) {
  this.axis = axis;
  this.axish = cycleAxis(axis);
  this.axisv = cycleAxis(this.axish);
  this.up = new THREE.Vector3();
  this.up[axis] = 1;

  this.epsilon = 0.0000001;

  this.count = 0;
  this.area = 0;
  this.hole = false;
  this.vertex = null;

  // nodes that are maximal/minimal on axes 1 and 2 - used for bounding-box
  // tests and for joining holes
  this.minh = null;
  this.maxh = null;
  this.minv = null;
  this.maxv = null;

  this.holes = [];

  if (!vertices || vertices.length < 1) return;

  var start = null;

  for (var i = 0; i < vertices.length; i++) {
    var v = vertices[i];

    // create the node for this vertex
    var node = {
      v: v,
      idx: indices[i],
      prev: null,
      next: null,
      ear: false
    };

    this.updateBounds(node);

    // insert into the linked list
    if (this.vertex) {
      node.prev = this.vertex;
      this.vertex.next = node;
    }
    else start = node;

    this.vertex = node;

    this.count++;
    if (this.count > 2) {
      this.area += triangleArea(start.v, this.vertex.prev.v, this.vertex.v, axis);

      // if the last three vertices are collinear, remove the middle vertex
      var pp = this.vertex.prev.prev;
      var p = this.vertex.prev;

      var area = triangleArea(pp.v, p.v, this.vertex.v, axis);
      if (Math.abs(area) < this.epsilon) {
        pp.next = this.vertex;
        this.vertex.prev = pp;

        this.count--;
      }
    }
  }

  // close the last connection
  this.vertex.next = start;
  start.prev = this.vertex;

  if (this.area < 0) this.hole = true;

  // calculate reflex state
  var current = this.vertex;
  var up = this.up;
  do {
    this.nodeCalculateReflex(current);

    current = current.next;
  } while (current != this.vertex);
}

EdgeLoop.prototype.updateBounds = function(n) {
  var ah = this.axish;
  var av = this.axisv;

  if (this.minh === null) {
    this.minh = n;
    this.maxh = n;
    this.minv = n;
    this.maxv = n;
  }
  else {
    this.minh =  this.minh.v[ah] < n.v[ah] ? this.minh : n;
    this.maxh =  this.maxh.v[ah] > n.v[ah] ? this.maxh : n;
    this.minv =  this.minv.v[av] < n.v[av] ? this.minv : n;
    this.maxv =  this.maxv.v[av] > n.v[av] ? this.maxv : n;
  }
}

// test if this edge loop contains the other edge loop
EdgeLoop.prototype.contains = function(other) {
  // horizontal and vertical axes; the convention is that we're looking along
  // negative this.axis, ah points right and av points up - we'll call
  // pt[ah] h and pt[av] v
  var ah = this.axish;
  var av = this.axisv;

  // bounding box tests first as they are cheaper
  if (this.maxh.v[ah] < other.minh.v[ah] || this.minh.v[ah] > other.maxh.v[ah]) {
    return false;
  }
  if (this.maxv.v[av] < other.minv.v[av] || this.minv.v[av] > other.maxv.v[av]) {
    return false;
  }

  // else, do point-in-polygon testing

  // use other's entry vertex
  var pt = other.vertex.v;

  return this.containsPoint(pt);
}

// point-in-polygon testing - see if some point of other is inside this loop;
// see O'Rourke's book, sec. 7.4
EdgeLoop.prototype.containsPoint = function(pt) {
  var ah = this.axish;
  var av = this.axisv;
  var h = pt[ah];
  var v = pt[av];

  // number of times a ray crosses
  var crossCount = 0;

  var current = this.vertex;
  do {
    var s1 = current.v;
    var s2 = current.next.v;

    // segment encloses pt on vertical axis
    if ((s1[av] >= v && s2[av] < v) || (s2[av] >= v && s1[av] < v)) {
      // calcualte intersection
      var intersection = raySegmentIntersectionOnAxis(s1, s2, pt, ah, av);

      // if intersection strictly to the right of pt, it crosses the segment
      if (intersection > h) crossCount++;
    }

    current = current.next;
  } while (current != this.vertex);

  return crossCount%2 != 0;
}

// join the polygon with the holes it immediately contains so that it can be
// triangulated as a single convex polygon
// see David Eberly's writeup - we cast a ray to the right, see where it
// intersects the closest segment, then check inside a triangle
EdgeLoop.prototype.mergeHolesIntoPoly = function() {
  var axis = this.axis;
  var ah = this.axish;
  var av = this.axisv;

  var holes = this.holes;

  // sort holes on maximal vertex on axis 1 in descending order
  // once sorted, start merging from rightmost hole
  holes.sort(function(a,b) {
    var amax = a.maxh.v[ah];
    var bmax = b.maxh.v[ah];

    if (amax > bmax) return -1;
    if (amax < bmax) return 1;
    return 0;
  });


  for (var i=0; i<holes.length; i++) {
    var hole = holes[i];

    var P = this.findVisiblePointFromHole(hole);

    this.mergeHoleIntoPoly(P, hole, hole.maxh);
  }

  return;
}

// join vertex node in polygon to given vertex node in hole
EdgeLoop.prototype.mergeHoleIntoPoly = function(polyNode, hole, holeNode) {
  // loop goes CCW around poly, exits the poly, goes around hole, exits hole,
  // enters poly
  var polyExit = polyNode;
  var holeEntry = holeNode;
  // have to duplicate the vertex nodes
  var holeExit = Object.assign({}, holeEntry);
  var polyEntry = Object.assign({}, polyExit);

  // update vert nodes that are next to those that got copied
  holeEntry.prev.next = holeExit;
  polyExit.next.prev = polyEntry;

  // make degenerate edges
  polyExit.next = holeEntry;
  holeEntry.prev = polyExit;
  holeExit.next = polyEntry;
  polyEntry.prev = holeExit;

  // update reflex state
  this.nodeCalculateReflex(polyExit);
  this.nodeCalculateReflex(holeEntry);
  this.nodeCalculateReflex(holeExit);
  this.nodeCalculateReflex(polyEntry);

  this.count += hole.count + 2;
  this.area += hole.area;
}

EdgeLoop.prototype.findVisiblePointFromHole = function(hole) {
  var axis = this.axis;
  var ah = this.axish;
  var av = this.axisv;

  // hole's rightmost point
  var M = hole.maxh.v;
  // closest intersection of ray from M and loop edges along axis ah
  var minIAxis = Infinity;
  // full vector of intersection, directly to the right of m
  var I = M.clone();
  // vertex node at which intersection edge starts
  var S;

  // check all segments for intersection
  var current = this.vertex;
  do {
    var v = current.v;
    var vn = current.next.v;

    // polygon winds conterclockwise, so, if m is inside and the right-ward
    // ray intersects the v-vn segment, v must be less than m and vn must be
    // greater than m on the vertical axis
    if (vn[av] > M[av] && v[av] <= M[av]) {
      var IAxis = raySegmentIntersectionOnAxis(v, vn, M, ah, av);

      if (IAxis > M[ah] && IAxis < minIAxis) {
        minIAxis = IAxis;
        I[ah] = IAxis;
        S = current;
      }
    }

    current = current.next;
  } while (current != this.vertex);

  // candidate for the final node guaranteed to be visible from the hole's
  // rightmost point
  var P = S;

  // check all reflex verts; if they're present inside the triangle between m,
  // the intersection point, and the edge source, then return the one with the
  // smallest angle with the horizontal
  current = this.vertex;

  var angle = Math.PI/2;
  var hEdge = I.clone().sub(M).normalize();
  do {
    if (current.reflex) {
      // if the point is inside the triangle formed by intersection segment
      // source, intersection point, and ray source, then might need to update
      // the visible node to the current one
      if (pointInsideTriangle(current.v, S.v, I, M, axis)) {
        var newEdge = current.v.clone.sub(M).normalize();
        var newAngle = hEdge.angleTo(newEdge);

        if (newAngle < angle) {
          angle = newAngle;
          P = current;
        }
      }
    }

    current = current.next;
  } while (current != this.vertex);

  return P;
}

// triangulation by ear clipping
// returns an array of 3*n indices for n new triangles
// see O'Rourke's book for details
EdgeLoop.prototype.triangulate = function() {
  this.calculateEars();

  var count = this.count;

  var indices = [];

  while (count > 3) {
    var current = this.vertex;
    var added = false;
    do {
      if (current.ear) {
        added = true;
        var p = current.prev;
        var n = current.next;

        indices.push(p.idx);
        indices.push(current.idx);
        indices.push(n.idx);

        p.next = n;
        n.prev = p;

        this.vertex = n;

        this.nodeCalculateEar(p);
        this.nodeCalculateReflex(p);
        this.nodeCalculateEar(n);
        this.nodeCalculateReflex(n);

        count--;

        break;
      }

      current = current.next;
    } while (current != this.vertex);

    // in case we failed to find an ear, break to avoid an infinite loop
    if (!added) break;
  }

  indices.push(this.vertex.prev.idx);
  indices.push(this.vertex.idx);
  indices.push(this.vertex.next.idx);

  this.count = count;

  return indices;
}

// calculate ear status of all ears
EdgeLoop.prototype.calculateEars = function() {
  var current = this.vertex;
  do {
    this.nodeCalculateEar(current);

    current = current.next;
  } while (current != this.vertex);
}

EdgeLoop.prototype.nodeCalculateEar = function(node) {
  node.ear = this.diagonal(node);
}

EdgeLoop.prototype.diagonal = function(node) {
  var p = node.prev;
  var n = node.next;

  return this.inCone(p, n) && this.inCone(n, p) && this.nonintersection(p, n);
}

EdgeLoop.prototype.inCone = function(a, b) {
  var axis = this.axis;
  var apv = a.prev.v;
  var anv = a.next.v;

  if (a.reflex) return !(leftOn(anv, a.v, b.v, axis) && leftOn(a.v, apv, b.v, axis));
  else return left(apv, a.v, b.v, axis) && left(a.v, anv, b.v, axis);
}

EdgeLoop.prototype.nonintersection = function(a, b) {
  var axis = this.axis;
  var c = this.vertex;

  do {
    var d = c.next;

    // only segments not sharing a/b as endpoints can intersect ab segment
    if (c!=a && c!=b && d!=a && d!=b) {
      if (segmentSegmentIntersection(a.v, b.v, c.v, d.v, axis)) return false;
    }

    c = c.next;
  } while (c != this.vertex);

  return true;
}

// TODO: remove debugging
function debugLoop(loop, fn) {
  if (fn === undefined) fn = function() { return true; };
  var curr = loop.vertex;
  do {
    if (fn(curr)) addDebugVertex(curr.v);
    curr = curr.next;
  } while (curr != loop.vertex);
}
function addDebugVertex(v) {
  debugGeo.vertices.push(v);
  debugGeo.verticesNeedUpdate = true;
}
function debug() {
  var debugMaterial = new THREE.PointsMaterial( { color: 0xff0000, size: 5, sizeAttenuation: false });
  var debugMesh = new THREE.Points(debugGeo, debugMaterial);
  debugMesh.name = "debug";
  scene.add(debugMesh);

  var debugLineGeo = new THREE.Geometry();
  for (var i=0; i<debugGeo.vertices.length; i++) {
    debugLineGeo.vertices.push(debugGeo.vertices[i]);
    debugLineGeo.vertices.push(debugGeo.vertices[(i+1)%debugGeo.vertices.length]);
  }
  var debugLineMaterial = new THREE.LineBasicMaterial({color: 0xff6666, linewidth: 1 });
  var debugLineMesh = new THREE.LineSegments(debugLineGeo, debugLineMaterial);
  debugLineMesh.name = "debugLine";
  scene.add(debugLineMesh);
  debugGeo = new THREE.Geometry();
}

EdgeLoop.prototype.nodeCalculateReflex = function(node) {
  var area = triangleArea(node.prev.v, node.v, node.next.v, this.axis);

  if (area < 0) {
    // area calculation contains a subtraction, so when the result should be
    // exactly 0, it might go to something like -1e-17; if the area is less
    // than some reeeeeally small epsilon, it doesn't matter if it's reflex
    // anyway, so might as well call those vertices convex
    if (Math.abs(area) > this.epsilon) node.reflex = true;
  }
  else node.reflex = false;
}

SliceBuilder = function(axis) {
  this.p = Math.pow(10, 9);
  this.axis = axis;
  this.up = new THREE.Vector3();
  this.up[axis] = 1;

  this.adjacencyMap = {};
}

SliceBuilder.prototype.clear = function() {
  this.adjacencyMap = {};
}

SliceBuilder.prototype.addSegment = function(v1, v2, normal, idx1, idx2) {
  this.insertNeighbor(v1, v2, normal, idx1);
  this.insertNeighbor(v2, v1, normal, idx2);
}

SliceBuilder.prototype.insertNeighbor = function(v1, v2, n, idx1) {
  var v1hash = vertexHash(v1, this.p);

  var a = this.adjacencyMap;

  if (!a.hasOwnProperty(v1hash)) a[v1hash] = {
    v : v1,
    idx: idx1,
    neighbors: [],
    normals: [],
    visited: false
  };

  var v2hash = vertexHash(v2, this.p);
  if (v1hash == v2hash) return;

  a[v1hash].neighbors.push(v2);
  a[v1hash].normals.push(n);
}

SliceBuilder.prototype.makePolys = function() {
  var a = this.adjacencyMap;
  var up = this.up;
  var axis = this.axis;
  var p = this.p;

  var loops = {
    polys: [],
    holes: []
  };

  // repeats until adjacency map is empty
  while (!objectIsEmpty(a)) {
    // vertex hashes for start, current, and prev
    var start = null;
    var current = null;
    var prev = null;

    // pick a random vertex
    for (key in a) {
      start = key;
      break;
    }

    // should never happen, but just in case
    if (start == null) break;

    var vertices = [];
    var indices = [];

    var neighbors, normals;

    current = start;

    // go along the loop till it closes
    do {
      if (!a.hasOwnProperty(current)) break;

      vertices.push(a[current].v);
      indices.push(a[current].idx);

      v = a[current].v;
      neighbors = a[current].neighbors;
      normals = a[current].normals;

      delete a[current];

      next = vertexHash(neighbors[0], p);

      // if current is the first vertex
      if (!prev) {
        var nextData = a[next];
        // initialize:
        // pick the neighbor that's CCW from current for normal edge loops and
        // CW for holes: vector along axis normal to the plane crossed with an
        // edge's normal should have a positive component along the CCW edge
        var dot = up.clone().cross(normals[0]).dot(nextData.v.clone().sub(v));
        if (dot < 0) next = vertexHash(neighbors[1], p);

        prev = current;
        current = next;
      }
      // else, continuing the loop
      else {
        if (next == prev) next = vertexHash(neighbors[1], p);

        prev = current;
        current = next;
      }

    } while (current != start);

    var edgeLoop = new EdgeLoop(axis, vertices, indices);

    if (edgeLoop.hole) loops.holes.push(edgeLoop);
    else loops.polys.push(edgeLoop);
  }

  // assign holes to the polys containing them
  this.calculateHierarchy(loops);

  // merge each poly's holes into the poly
  for (var i=0; i<loops.polys.length; i++) {
    loops.polys[i].mergeHolesIntoPoly();
  }

  return loops.polys;
}

SliceBuilder.prototype.calculateHierarchy = function(loops) {
  var polys = loops.polys;
  var holes = loops.holes;
  var np = polys.length;
  var nh = holes.length;

  // for every polygon, make sets of polys/holes inside/outside
  // e.g., if polysInside[i] contains entry j, then poly i contains poly j;
  // if holesOutside[i] contains entry j; then poly i does not contain hole j
  var polysInside = new Array(np);
  var polysOutside = new Array(np);
  var holesInside = new Array(np);
  var holesOutside = new Array(np);
  for (var i=0; i<np; i++) {
    polysInside[i] = new Set();
    polysOutside[i] = new Set();
    holesInside[i] = new Set();
    holesOutside[i] = new Set();
  }

  // tests whether poly i contains poly j
  for (var i=0; i<np; i++) {
    for (var j=0; j<np; j++) {
      if (i==j) continue;

      // if j contains i, then i does not contain j
      if (polysInside[j].has(i)) {
        polysOutside[i].add(j);
        // if j contains i, then i does not contain polys j does not contain
        polysOutside[i] = new Set([...polysOutside[i], ...polysOutside[j]]);
        continue;
      }

      var ipoly = polys[i];
      var jpoly = polys[j];

      if (ipoly.contains(jpoly)) {
        polysInside[i].add(j);
        // if i contains j, i also contains polys j contains
        polysInside[i] = new Set([...polysInside[i], ...polysInside[j]]);
      }
      else {
        polysOutside[i].add(j);
        // if i does not contain j, i does not contain anything j contains
        polysOutside[i] = new Set([...polysOutside[i], ...polysInside[j]]);
      }
    }
  }

  // test whether poly i contains hole j
  for (var i=0; i<np; i++) {
    for (var j=0; j<nh; j++) {
      var ipoly = polys[i];
      var jhole = holes[j];

      if (ipoly.contains(jhole)) holesInside[i].add(j);
      else holesOutside[i].add(j);
    }
  }

  // back up the initial hole containment data so we can reference it while we
  // mutate the actual data
  var sourceHolesInside = new Array(np);
  for (var i=0; i<np; i++) {
    sourceHolesInside[i] = new Set(holesInside[i]);
  }

  // if poly i contains poly j, eliminate holes contained by j from i's list
  for (var i=0; i<np; i++) {
    for (var j=0; j<np; j++) {
      if (i==j) continue;

      var ipoly = polys[i];
      var jpoly = polys[j];

      if (polysInside[i].has(j)) {
        var iholes = holesInside[i];
        var sjholes = sourceHolesInside[j];

        // for every hole in j, if i contains it, delete it from i's holes so
        // that every poly only has the holes which it immediately contains
        for (var jh of sjholes) iholes.delete(jh);
      }
    }
  }
  // build the hole array for every edge loop
  for (var i=0; i<np; i++) {
    var ipoly = polys[i];

    for (var h of holesInside[i]) ipoly.holes.push(holes[h]);
  }
}

SliceBuilder.prototype.getSlice = function() {
  var polys = this.makePolys();

  return new Slice(polys);
}
