/* slicer.js */

var scene; // for debugging, todo: remove
var debugGeo = new THREE.Geometry();
var debugLineGeo = new THREE.Geometry();

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
  // then this.ah points right and this.av points up
  this.ah = cycleAxis(this.axis);
  this.av = cycleAxis(this.ah);

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

  var layerBuilder = new LayerBuilder(axis);

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

      layerBuilder.addSegment(AB, AC, newFace.normal, idxAB, idxAC);
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

      layerBuilder.addSegment(AC, BC, newFace2.normal, idxAC, idxBC);
    }
  }

  // put the new verts and faces on the end of the existing array
  this.previewVertices = vertices.concat(newVertices);
  this.previewFaces = faces.concat(newFaces);

  // erase whatever we allocated and didn't need
  this.previewVertices.length = vertexCount + vidx;
  this.previewFaces.length = faceCount + fidx;

  var layer = layerBuilder.getLayer();
  var triIndices = layer.triangulate();

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

  var layerBuilder = new LayerBuilder(this.axis);
  var timer = new Timer();
  timer.start();

  for (var i=0; i<segmentLists.length; i++) {
    var segmentList = segmentLists[i];
    for (var s=0; s<segmentList.length; s++) {
      var segment = segmentList[s];

      layerBuilder.addSegment(segment[0], segment[1], segment[2]);
    }

    var layer = layerBuilder.getLayer();

    if (i!=2) continue;

    layer.writeBaseContoursToVerts(this.pathVertices);
    layer.makeSkeletons();
    layerBuilder.clear();
  }

  timer.stop();
  debugPoints();

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

        layerSegmentList.push([int1, int2, bounds.face.normal]);
      }
    }

    layerSegmentLists[i] = layerSegmentList;
  }

  return layerSegmentLists;
}



// contains a single slice of the mesh
Layer = function(polys) {
  this.polys = polys;
  this.skeletons = [];
  this.contours = [];
  this.infill = [];
}

Layer.prototype.triangulate = function() {
  // polys is an array of edgeloops signifying every polygon in the slice
  var polys = this.polys;
  var indices = [];

  for (var i=0; i<polys.length; i++) {
    var poly = polys[i];
    poly.mergeHolesIntoPoly();
    indices = indices.concat(poly.triangulate());
  }
  // todo: remove
  if (polys.length>0) debugPoints();

  return indices;
}

Layer.prototype.makeSkeletons = function() {
  for (var i=0; i<this.polys.length; i++) {
    var skeleton = new StraightSkeleton(this.polys[i]);
    this.skeletons.push(skeleton);
  }
}

Layer.prototype.writeBaseContoursToVerts = function(vertices) {
  for (var i=0; i<this.polys.length; i++) {
    var poly = this.polys[i];

    poly.writeSegments(vertices);
  }
}

// circular double-linked list symbolizing an edge loop
Polygon = function(axis, vertices, indices) {
  this.axis = axis;
  this.ah = cycleAxis(axis);
  this.av = cycleAxis(this.ah);
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
      reflex: false,
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
    }
  }

  // close the last connection
  this.vertex.next = start;
  start.prev = this.vertex;

  // eliminate collinear vertices
  start = null;
  var current = this.vertex;
  do {
    if (this.collinear(current)) {
      this.removeNode(current);
    }
    else {
      if (!start) start = current;
    }

    current = current.next;
  } while (current != start);

  this.vertex = start;

  // negative area means the poly is a hole, so set a readable parameter
  if (this.area < 0) this.hole = true;

  // calculate reflex state
  current = this.vertex;
  var up = this.up;
  do {
    this.nodeCalculateReflex(current);

    current = current.next;
  } while (current != this.vertex);
}

Polygon.prototype.updateBounds = function(n) {
  var ah = this.ah;
  var av = this.av;

  if (this.minh === null) {
    this.minh = n;
    this.maxh = n;
    this.minv = n;
    this.maxv = n;
  }
  else {
    this.minh = this.minh.v[ah] < n.v[ah] ? this.minh : n;
    this.maxh = this.maxh.v[ah] > n.v[ah] ? this.maxh : n;
    this.minv = this.minv.v[av] < n.v[av] ? this.minv : n;
    this.maxv = this.maxv.v[av] > n.v[av] ? this.maxv : n;
  }
}

Polygon.prototype.collinear = function(node) {
  var p = node.prev;
  var n = node.next;
  return collinear(p.v, node.v, n.v, this.axis, this.epsilon)
}

Polygon.prototype.removeNode = function(node) {
  node.prev.next = node.next;
  node.next.prev = node.prev;

  this.count--;
}

// test if this edge loop contains the other edge loop
Polygon.prototype.contains = function(other) {
  // horizontal and vertical axes; the convention is that we're looking along
  // negative this.axis, ah points right and av points up - we'll call
  // pt[ah] h and pt[av] v
  var ah = this.ah;
  var av = this.av;

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
Polygon.prototype.containsPoint = function(pt) {
  var axis = this.axis;
  var ah = this.ah;
  var av = this.av;
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
      // calculate intersection
      var intersection = raySegmentIntersectionOnHAxis(s1, s2, pt, axis);

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
Polygon.prototype.mergeHolesIntoPoly = function() {
  var axis = this.axis;
  var ah = this.ah;
  var av = this.av;

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
Polygon.prototype.mergeHoleIntoPoly = function(polyNode, hole, holeNode) {
  // loop goes CCW around poly, exits the poly, goes around hole, exits hole,
  // enters poly
  var polyExit = polyNode;
  var holeEntry = holeNode;
  // have to duplicate the vertex nodes
  var holeExit = shallowCopy(holeEntry);
  var polyEntry = shallowCopy(polyExit);

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

Polygon.prototype.findVisiblePointFromHole = function(hole) {
  var axis = this.axis;
  var ah = this.ah;
  var av = this.av;

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
      var IAxis = raySegmentIntersectionOnHAxis(v, vn, M, axis);

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
Polygon.prototype.triangulate = function() {
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
Polygon.prototype.calculateEars = function() {
  var current = this.vertex;
  do {
    this.nodeCalculateEar(current);

    current = current.next;
  } while (current != this.vertex);
}

Polygon.prototype.nodeCalculateEar = function(node) {
  node.ear = this.diagonal(node);
}

Polygon.prototype.diagonal = function(node) {
  var p = node.prev;
  var n = node.next;

  return this.inCone(p, n) && this.inCone(n, p) && this.nonintersection(p, n);
}

Polygon.prototype.inCone = function(a, b) {
  var axis = this.axis;
  var apv = a.prev.v;
  var anv = a.next.v;

  if (a.reflex) return !(leftOn(anv, a.v, b.v, axis) && leftOn(a.v, apv, b.v, axis));
  else return left(apv, a.v, b.v, axis) && left(a.v, anv, b.v, axis);
}

Polygon.prototype.nonintersection = function(a, b) {
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
    if (fn(curr)) debugVertex(curr.v);
    curr = curr.next;
  } while (curr != loop.vertex);
}
function debugLine(v, w, n, lastonly, offset) {
  if (n === undefined) n = 1;
  if (offset === undefined) offset = 0;

  for (var i=0; i<=n; i++) {
    if (lastonly && (n==0 || i<n-1)) continue;
    var vert = w.clone().multiplyScalar(i/n).add(v.clone().multiplyScalar((n-i)/n));
    vert.z += 0.1*offset;
    debugGeo.vertices.push(vert);
  }
  var vv = v.clone();
  vv.z += 0.1*offset;
  var ww = w.clone();
  ww.z += 0.1*offset;
  debugLineGeo.vertices.push(vv);
  debugLineGeo.vertices.push(ww);
  debugGeo.verticesNeedUpdate = true;
}
function debugVertex(v) {
  debugGeo.vertices.push(v);
  debugGeo.verticesNeedUpdate = true;
}
function debugPoints() {
  var debugMaterial = new THREE.PointsMaterial( { color: 0xff0000, size: 5, sizeAttenuation: false });
  var debugMesh = new THREE.Points(debugGeo, debugMaterial);
  debugMesh.name = "debug";
  scene.add(debugMesh);

  debugGeo = new THREE.Geometry();
}
function debugLines(idx, incr) {
  var color = 0xff6666;
  if (idx!==undefined) {
    color = parseInt(('0.'+Math.sin(idx+incr).toString().substr(6))*0xffffff);
    console.log("%c idx "+idx, 'color: #'+color.toString(16));
  }
  else idx = 0;
  var debugLineMaterial = new THREE.LineBasicMaterial({color: color, linewidth: 1 });
  var debugLineMesh = new THREE.LineSegments(debugLineGeo, debugLineMaterial);
  debugLineMesh.name = "debugLine";
  scene.add(debugLineMesh);

  debugLineGeo = new THREE.Geometry();
}
function debugCleanup() {
  removeMeshByName(this.scene, "debug");
  removeMeshByName(this.scene, "debugLine");
}

Polygon.prototype.nodeCalculateReflex = function(node) {
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

Polygon.prototype.writeSegments = function(vertices) {
  var loops = [this].concat(this.holes);

  for (var i=0; i<loops.length; i++) {
    var loop = loops[i];
    var curr = loop.vertex;
    do {
      vertices.push(curr.v);
      vertices.push(curr.next.v);

      curr = curr.next;
    } while (curr != loop.vertex);
  }
}

SSHalfedge = function(node) {
  this.id = -1;
  this.node = node;
  this.next = null;
  this.twin = null;
}

SSHalfedge.prototype.prev = function() {
  var twin = this.twin;

  while (twin.next != this) twin = twin.next.twin;

  return twin;
}

SSHalfedge.prototype.nstart = function() {
  return this.node;
}

SSHalfedge.prototype.nend = function() {
  return this.next.node;
}

SSHalfedge.prototype.rotated = function() {
  return this.twin.next;
}

SSHalfedgeFactory = function() {
  this.id = 0;
  this.halfedges = [];
}

SSHalfedgeFactory.prototype.create = function(node) {
  var halfedge = new SSHalfedge(node);

  this.halfedges.push(halfedge);
  halfedge.id = this.id++;

  return halfedge;
}

SSNode = function(v) {
  this.id = -1;
  // vertex
  this.v = v;
  // one of the 1+ halfedges starting at this node
  this.halfedge = null;
  // true if reflex contour vertex
  this.reflex = false;
}

SSNode.prototype.isolated = function() {
  return this.halfedge == null;
}

SSNode.prototype.terminal = function() {
  return this.halfedge.twin.next == this.halfedge;
}

SSNode.prototype.setReflex = function(reflex) {
  this.reflex = reflex;
}

SSNodeFactory = function() {
  this.id = 0;
  this.nodes = [];
}

SSNodeFactory.prototype.create = function(v) {
  var node = new SSNode(v);

  this.nodes.push(node);
  node.id = this.id++;

  return node;
}

SSConnector = function(nfactory, hefactory) {
  this.nfactory = nfactory;
  this.hefactory = hefactory;
}

SSConnector.prototype.connectNodeToNode = function(nsource, ntarget) {
  var st = this.hefactory.create(nsource);
  var ts = this.hefactory.create(ntarget);

  // the halfedge listed on the node is arbitrary, so set it here to make sure
  nsource.halfedge = st;
  ntarget.halfedge = ts;

  st.twin = ts;
  st.next = ts;
  ts.twin = st;
  ts.next = st;

  return ts;
}

// connect the vertex node starting at the source halfedge to the given
// isolated node
SSConnector.prototype.connectHalfedgeToNode = function(hesource, ntarget) {
  if (!ntarget.isolated()) return null;

  var nsource = hesource.node;

  var hesourceIn = hesource.prev();
  var hesourceOut = hesource;

  // create the connecting halfedges
  var hetargetsource = this.connectNodeToNode(nsource, ntarget);
  var hesourcetarget = hetargetsource.twin;

  // link the halfedges correctly
  hesourceIn.next = hesourcetarget;
  hetargetsource.next = hesourceOut;

  return hetargetsource;
}

// connect the vertex node starting at the source halfedge to the vertex node
// starting at the target halfedge while preserving orientation;
// this is distinct from .connectHalfedgeToNode because we don't necessarily
// know which of the incoming/outgoing halfedge pairs incident on the target
// node should be connected
SSConnector.prototype.connectHalfedgeToHalfedge = function(hesource, hetarget) {
  var nsource = hesource.node;
  var ntarget = hetarget.node;

  var hesourceIn = hesource.prev();
  var hesourceOut = hesource;

  var hetargetIn = hetarget.prev();
  var hetargetOut = hetarget;

  // create the connecting halfedges
  var hetargetsource = this.connectNodeToNode(nsource, ntarget);
  var hesourcetarget = hetargetsource.twin;

  // link the halfedges correctly

  hesourceIn.next = hesourcetarget;
  hesourcetarget.next = hetargetOut;

  hetargetIn.next = hetargetsource;
  hetargetsource.next = hesourceOut;

  return hetargetsource;
}

// represents a bidirectional edge coincident with a particular halfedge that's
// interior to the polygon (i.e., regardless of winding, polygon interior is on
// the left)
// helper class meant to make edge-related operators clearer
SSEdge = function(he) {
  this.he = he;

  var start = he.nstart().v;
  var end = he.nend().v;

  this.start = start;
  this.end = end;

  this.forward = end.clone().sub(start).normalize();
  this.backward = this.forward.clone().negate();
}

// straight skeleton uses a halfedge data structure; initialize from a polygon
// with holes so that initial halfedges wind CCW around interior of every
// contour and CW around the exterior of every contour;
// poly is assumed a closed, simple CCW contour with holes
StraightSkeleton = function(poly) {
  this.axis = poly.axis;
  this.ah = poly.ah;
  this.av = poly.av;

  // array of halfedges, one per separate contour
  this.entryHalfedges = [];

  this.nfactory = new SSNodeFactory();
  this.hefactory = new SSHalfedgeFactory();
  this.connector = new SSConnector(this.nfactory, this.hefactory);

  var nfactory = this.nfactory;
  var hefactory = this.hefactory;
  var connector = this.connector;

  var nodes = nfactory.nodes;
  var halfedges = hefactory.halfedges;

  // polygon and its holes in one array
  var contours = [poly].concat(poly.holes);

  // make vertex nodes and halfedges for every vert/edge in every contour
  for (var c = 0; c < contours.length; c++) {
    var cnode = contours[c].vertex;

    var count = 0;
    var nstart = null;
    var heprev = null;

    var curr = cnode;
    do {
      var v = curr.v;

      var n = nfactory.create(v);
      n.setReflex(curr.reflex);

      if (count == 0) nstart = n;
      else {
        var he;

        if (count == 1) he = connector.connectNodeToNode(nstart, n);
        else he = connector.connectHalfedgeToNode(heprev, n);

        heprev = he;

        he.contour = true;
        he.twin.contour = true;
      }

      count++;

      curr = curr.next;
    } while (curr != cnode);

    // close the gap between last and first nodes
    heprev = connector.connectHalfedgeToHalfedge(heprev, nstart.halfedge);

    this.entryHalfedges.push(heprev.twin);
  }

  var slav = this.makeslav();

  var contourNodeCount = nodes.length;

  // pq retrieves smallest-L node first
  var pqComparator = function (a, b) { return a.L - b.L; }
  var pq = new PriorityQueue({ comparator: pqComparator });

  for (var lav of slav) {
    var lnode = lav;
    do {
      if (lnode.intersection) pq.queue(lnode);

      lnode = lnode.next;
    } while (lnode != lav);
  }

  var ct = 0;
  while (pq.length > 0) {
    if (++ct > 2) break;
    var lnodeV = pq.dequeue();

    var eventType = lnodeV.eventType;

    // just in case
    if (eventType == this.eventTypes.noEvent) continue;

    var vI = lnodeV.intersection;
    var eventNode = lnodeV.eventNode;

    if (eventType == this.eventTypes.edgeEvent) {
      console.log("edge event", lnodeV.L);
      // in edge event, V's bisector intersects one of its neighbors' bisectors,
      // resulting in the collapse of the edge between them to an internal
      // straight skeleton node

      // set the two nodes such that B is CCW from A
      var lnodeA, lnodeB;
      if (eventNode == lnodeV.prev) {
        lnodeA = lnodeV.prev;
        lnodeB = lnodeV;
      }
      else {
        lnodeA = lnodeV;
        lnodeB = lnodeV.next;
      }

      if (lnodeA.processed || lnodeB.processed) continue;

      // insert the intersection vertex into the skeleton

      // new node at intersection
      var nI = nfactory.create(vI);

      // link A to I
      var heA = lnodeA.he;
      var heAI = connector.connectHalfedgeToNode(heA, nI);
      lnodeA.processed = true;

      // link B to I
      var heB = lnodeB.he;
      var heBI = connector.connectHalfedgeToHalfedge(heB, heAI);
      lnodeB.processed = true;

      // reached a peak of the roof, so close it with three edges
      if (lnodeA.prev.prev == lnodeB) {
        var lnodeC = lnodeA.prev;
        var heC = lnodeC.he;

        connector.connectHalfedgeToHalfedge(heC, heBI);

        lnodeC.processed = true;
        continue;
      }

      // make a new LAV node at the intersection
      var lnodeI = this.makelavnode(heBI);

      var newprev = lnodeA.prev;
      var newnext = lnodeB.next;
      newprev.next = lnodeI;
      lnodeI.prev = newprev;
      newnext.prev = lnodeI;
      lnodeI.next = newnext;

      // associate with the correct contour edges
      lnodeI.edge = lnodeB.edge;

      // calculate bisector from contour edges and the resulting intersection,
      // if any, with neighboring LAV nodes' bisectors
      this.calculateBisector(lnodeI);
      this.calculateBisectorIntersection(lnodeI);

      // if potential new event, push to PQ
      if (lnodeI.eventType != this.eventTypes.noEvent) pq.queue(lnodeI);
    }
    else if (eventType == this.eventTypes.splitEvent) {
      console.log("split event", lnodeV.L);
      // in split event, V's bisector causes a given edge to split

      // the split edge is between A and B (B is CCW from A)
      var lnodeA = eventNode;
      var lnodeB = eventNode.next;

      if (lnodeA.processed || lnodeB.processed) continue;

      // V's predecessor and successor
      var lnodeP = lnodeV.prev;
      var lnodeN = lnodeV.next;

      // the edge that's split
      var edge = lnodeA.edge;

      // put a new skeleton vertex node at split point
      var nI = nfactory.create(vI);

      // halfedge from V
      var heV = lnodeV.he;

      // connect V to I
      var heVI = connector.connectHalfedgeToNode(heV, nI);
      lnodeV.processed = true;

      // split the LAV in two by creating two new LAV nodes at the intersection
      // and linking their neighbors and the split edge's endpoints accordingly

      // new LAV node on the A-N side of I
      var lnodeAIN = this.makelavnode(heVI);
      // new LAV node on the M-B side of I
      var lnodePIB = this.makelavnode(heVI);

      // link the A-N side of I
      lnodeA.next = lnodeAIN;
      lnodeAIN.prev = lnodeA;
      lnodeN.prev = lnodeAIN;
      lnodeAIN.next = lnodeN;

      // link the P-B side of I
      lnodeP.next = lnodePIB;
      lnodePIB.prev = lnodeP;
      lnodeB.prev = lnodePIB;
      lnodePIB.next = lnodeB;

      // link the appropriate edges
      lnodeAIN.edge = lnodeV.edge;
      lnodePIB.edge = edge;

      // calculate the new nodes' bisectors from contour edges and the resulting
      // intersection, if any, with neighboring LAV nodes' bisectors
      this.calculateBisector(lnodeAIN);
      this.calculateBisectorIntersection(lnodeAIN);
      this.calculateBisector(lnodePIB);
      this.calculateBisectorIntersection(lnodePIB);

      // if potential new event, push to PQ
      if (lnodeAIN.eventType != this.eventTypes.noEvent) pq.queue(lnodeAIN);
      if (lnodePIB.eventType != this.eventTypes.noEvent) pq.queue(lnodePIB);
    }
  }

  var offset = 0;
  for (var i=contourNodeCount; i<nodes.length; i++) {
    var node = nodes[i];

    var he = node.halfedge;
    do {
      var vs = node.v.clone();
      var ve = he.nend().v.clone();
      //vs.z += offset;
      //ve.z += offset;
      debugLine(vs, ve);

      he = he.rotated();
    } while (he != node.halfedge);
    offset += 0.1;
  }
  debugLines();

  return;
}

// basically an enum
StraightSkeleton.prototype.eventTypes = {
  noEvent: 0,
  edgeEvent: 1,
  splitEvent: 2
}

// LAV: list of active vertices (technically, halfedges originating from the
// active vertices), one for each contour
// SLAV: set of LAVs - the current fronts for propagating the skeleton
//
// creates a SLAV, initialized to correspond to the initial contours of the poly
// and its holes, and calculates all the initial events
StraightSkeleton.prototype.makeslav = function() {
  var slav = new Set();

  for (var i=0; i<this.entryHalfedges.length; i++) {
    var hestart = this.entryHalfedges[i];

    var lav = null;
    var lstart = null;

    var he = hestart;
    do {
      // lav node, implicitly signifies vertex at start of given halfedge
      var lnode = this.makelavnode(he);

      if (lav) {
        lnode.prev = lav;
        lav.next = lnode;
      }
      else lstart = lnode;

      lav = lnode;

      he = he.next;
    } while (he != hestart);

    lav.next = lstart;
    lstart.prev = lav;

    var lcurr;

    // calculate forward and backward edges
    lcurr = lav;
    do {
      this.setEdge(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // calculate bisectors
    lcurr = lav;
    do {
      this.calculateBisector(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // calculate bisector intersections
    lcurr = lav;
    do {
      this.calculateBisectorIntersection(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    slav.add(lav);
  }

  // for every vertex (if reflex), get the split events it causes
  for (var lav of slav) {
    var lcurr = lav;
    do {
      this.calculateSplitEvent(lcurr, slav);

      lcurr = lcurr.next;
    } while (lcurr != lav);
  }

  return slav;
}

StraightSkeleton.prototype.makelavnode = function(he) {
  return {
    // skeleton halfedge that starts at this vertex
    he: he,
    // for ease of access
    v: he.node.v,
    reflex: he.node.reflex,

    // prev/next nodes in lav
    prev: null,
    next: null,

    // flag - true means that the vert will not take part in further events
    processed: false,

    // forward edge; backward edge is retrieved from previous node
    edge: null,

    // intersection stuff

    // normalized bisecting vector
    bisector: null,
    // event type - either edge or split, edge by default
    eventType: this.eventTypes.noEvent,
    // intersection point (edge and split events); null if no intersection
    intersection: null,
    // the other node involved in an event:
    // if edge event, this is the neighbor node that intersects the bisector;
    // if split event, this is node A such that the split edge starts at A
    eventNode: null,
    // distance from event point to a neighboring edge
    L: Infinity
  };
}

StraightSkeleton.prototype.setEdge = function(lnode) {
  lnode.edge = new SSEdge(lnode.he);
}

StraightSkeleton.prototype.calculateBisector = function(lnode) {
  var forward = lnode.edge.forward;
  var backward = lnode.prev.edge.backward;
  var bisector = forward.clone().add(backward).normalize();

  if (lnode.reflex) bisector.negate();

  lnode.bisector = bisector;
}

// given a node in the lav, see which of its neighbors' bisectors it intersects
// first (if any)
StraightSkeleton.prototype.calculateBisectorIntersection = function(lnode) {
  var axis = this.axis;

  var v = lnode.v;
  var b = lnode.bisector;
  var lprev = lnode.prev;
  var vprev = lprev.v;
  var bprev = lprev.bisector;
  var lnext = lnode.next;
  var vnext = lnext.v;
  var bnext = lnext.bisector;

  var iprev = rayLineIntersection(v, vprev, b, bprev, axis);
  var inext = rayLineIntersection(v, vnext, b, bnext, axis);

  // 0 if no intersection; 1 if prev is closer; 2 if next is closer
  var intersectionResult = 0;
  if (iprev && inext) {
    // distances from the intersections to v
    var diprev = iprev.distanceTo(v);
    var dinext = inext.distanceTo(v);

    if (diprev < dinext) intersectionResult = 1;
    else intersectionResult = 2;
  }
  else if (iprev) intersectionResult = 1;
  else if (inext) intersectionResult = 2;

  if (intersectionResult == 1) {
    lnode.intersection = iprev;
    lnode.eventNode = lprev;
    var edge = lprev.edge;
    lnode.L = distanceToLine(iprev, edge.start, edge.end, axis);
  }
  // intersection with next bisector is closer
  else if (intersectionResult == 2) {
    lnode.intersection = inext;
    lnode.eventNode = lnext;
    var edge = lnode.edge;
    lnode.L = distanceToLine(inext, edge.start, edge.end, axis);
  }

  if (intersectionResult != 0) lnode.eventType = this.eventTypes.edgeEvent;
}

// calculates the closest split event caused by V's bisector (if V is reflex);
// if no split event, leave it alone
StraightSkeleton.prototype.calculateSplitEvent = function(lnodeV, slav) {
  if (!lnodeV.reflex) return;

  var v = lnodeV.v;
  var b = lnodeV.bisector;
  var axis = this.axis;

  var splitPoint = null;
  // node that starts the edge that gets split
  var eventNode = null;
  var minL = Infinity;

  for (var lav of slav) {
    var lcurr = lav;
    do {
      // say current lnode is A and its next is B; we're considering the edge
      // between A and B through A and B
      var lnodeA = lcurr;
      var lnodeB = lcurr.next;

      lcurr = lcurr.next;

      // lnodeV's bisector will never split either of its incident edges
      if (lnodeA == lnodeV || lnodeB == lnodeV) continue;

      var edge = lnodeA.edge;
      var bA = lnodeA.bisector;
      var bB = lnodeB.bisector;

      var eAB = edge.forward;
      var vA = edge.start;
      var vB = edge.end;

      // intersection of V's bisector with AB line
      var intAB = rayLineIntersection(v, vA, b, eAB, axis);

      // if V's bisector doesn't intersect AB line, it can't split the AB edge
      if (intAB === null) continue;

      // now say the forward and backward edges emanating from V intersect the
      // AB line at points R and S (R is closer); find R, draw its bisector with
      // AB line, see where it intersects V's bisector

      // edges emanating from V - *reverse* forward/backward edges, respectively
      var efnV = lnodeV.edge.backward;
      var ebnV = lnodeV.prev.edge.forward;

      // pick the edge that's least parallel with the testing edge to avoid
      // the more parallel edge
      var fndotAB = Math.abs(efnV.dot(eAB));
      var bndotAB = Math.abs(ebnV.dot(eAB));
      var enV = (fndotAB < bndotAB) ? efnV : ebnV;

      // R is intersection point between the edge from V and the AB line
      var vR = rayLineIntersection(v, vA, enV, eAB, axis);

      if (vR === null) continue;

      // vector from R to V
      var eRV = v.clone().sub(vR).normalize();

      // need AB edge pointing along the above vector so that their bisector
      if (eRV.dot(eAB) < 0) eAB = eAB.clone().negate();

      // calculate bisector (not normalized) of AB line and RV vector
      var bRAB = eRV.add(eAB);

      // potential split event happens here
      var vSplit = rayLineIntersection(v, vR, b, bRAB, axis);

      if (vSplit === null) continue;

      // verify that the split event occurs within the area swept out by AB edge

      // A and A+A.bisector support the line that forms A's side of the edge's
      // sweep area; likewise for B
      var vAoffset = vA.clone().add(bA);
      var vBoffset = vB.clone().add(bB);

      // check if split point is inside the boundary
      if (!left(vA, vB, vSplit, axis)) continue;
      if (!left(vAoffset, vA, vSplit, axis)) continue;
      if (!left(vB, vBoffset, vSplit, axis)) continue;

      // valid split point, so see if it's the closest so far
      var L = distanceToLine(vSplit, vA, vB, axis);

      if (L < minL) {
        minL = L;
        splitPoint = vSplit;
        eventNode = lnodeA;
      }
    } while (lcurr != lav);
  }

  // if the closest split event we found is closer than the edge event already
  // calculated for V, set V's event to split and set the appropriate fields
  if (minL < lnodeV.L) {
    lnodeV.eventType = this.eventTypes.splitEvent;
    lnodeV.L = minL;
    lnodeV.intersection = splitPoint;
    lnodeV.eventNode = eventNode;
  }

  debugLines();
}

// add pairs of verts with .addSegment, then get the layer with .getLayer
// and .clear if reusing
LayerBuilder = function(axis) {
  this.p = Math.pow(10, 9);
  this.axis = axis;
  this.up = new THREE.Vector3();
  this.up[axis] = 1;

  this.adjacencyMap = {};
}

LayerBuilder.prototype.clear = function() {
  this.adjacencyMap = {};
}

LayerBuilder.prototype.addSegment = function(v1, v2, normal, idx1, idx2) {
  this.insertNeighbor(v1, v2, normal, idx1);
  this.insertNeighbor(v2, v1, normal, idx2);
}

LayerBuilder.prototype.insertNeighbor = function(v1, v2, n, idx1) {
  var v1hash = vertexHash(v1, this.p);

  var a = this.adjacencyMap;

  if (!a.hasOwnProperty(v1hash)) a[v1hash] = this.makeAdjMapNode(v1, idx1);

  var v2hash = vertexHash(v2, this.p);
  if (v1hash == v2hash) return;

  a[v1hash].neighbors.push(v2);
  a[v1hash].normals.push(n);
}

LayerBuilder.prototype.makeAdjMapNode = function(v1, idx1) {
  // don't store index if unavailable
  if (idx1 === undefined) return {
    v : v1,
    neighbors: [],
    normals: [],
    visited: false
  };
  else return {
    v : v1,
    idx: idx1,
    neighbors: [],
    normals: [],
    visited: false
  };
}

LayerBuilder.prototype.makePolys = function() {
  var a = this.adjacencyMap;
  var up = this.up;
  var axis = this.axis;
  var p = this.p;

  var edgeLoops = {
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

    var edgeLoop = new Polygon(axis, vertices, indices);

    if (edgeLoop.hole) edgeLoops.holes.push(edgeLoop);
    else edgeLoops.polys.push(edgeLoop);
  }

  // assign holes to the polys containing them
  this.calculateHierarchy(edgeLoops);

  return edgeLoops.polys;
}

LayerBuilder.prototype.calculateHierarchy = function(edgeLoops) {
  var polys = edgeLoops.polys;
  var holes = edgeLoops.holes;
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

LayerBuilder.prototype.getLayer = function() {
  var polys = this.makePolys();

  return new Layer(polys);
}
