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
  var current = this.vertex;
  do {
    if (this.collinear(current)) {
      if (current == this.vertex) this.vertex = current.next;

      this.removeNode(current);
    }

    current = current.next;
  } while (current != this.vertex);

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
    this.minh =  this.minh.v[ah] < n.v[ah] ? this.minh : n;
    this.maxh =  this.maxh.v[ah] > n.v[ah] ? this.maxh : n;
    this.minv =  this.minv.v[av] < n.v[av] ? this.minv : n;
    this.maxv =  this.maxv.v[av] > n.v[av] ? this.maxv : n;
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
    if (fn(curr)) addDebugVertex(curr.v);
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
function addDebugVertex(v) {
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

// straight skeleton uses a halfedge data structure; initialize from a polygon
// with holes so that initial halfedges wind CCW around interior of every
// contour and CW around the exterior of every contour;
// poly is assumed a closed, simple CCW contour with holes
StraightSkeleton = function(poly) {
  this.axis = poly.axis;
  this.ah = poly.ah;
  this.av = poly.av;
  // array of nodes (vertices); each has a halfedge
  this.nodes = [];
  // array of halfedges; each has a start vertex, next halfedge, and twin
  this.halfedges = [];
  // array of internal halfedge indices, one per separate contour
  this.entryHalfedgeIdxArray = [];

  var nodes = this.nodes;
  var halfedges = this.halfedges;

  // polygon and its holes in one array
  var contours = [poly].concat(poly.holes);

  // make vertex nodes and halfedges for every vert/edge in every contour
  for (var c=0; c<contours.length; c++) {
    var contour = contours[c];

    var prevheidx = -1;
    var startnidx = -1;
    var count = 0;

    var curr = contour.vertex;
    do {
      var v = curr.v;

      var nidx = this.makeNode(v);

      // if no nodes yet, just create one
      if (count == 0) startnidx = nidx;
      else {
        var heidx;
        // if only one other node, connect this node to that one
        if (count == 1) {
          heidx = this.makeHalfedgePair(startnidx, nidx);
        }
        // else, there's an existing halfedge to which to connect the new node
        else {
          heidx = this.connectHalfedgeToNode(prevheidx, nidx);
        }

        // todo: remove
        halfedges[heidx].contour = true;
        halfedges[this.halfedgeTwinIdx(heidx)].contour = true;

        prevheidx = heidx;
      }

      count++;

      curr = curr.next;
    } while (curr != contour.vertex);

    // join last halfedge to start node
    this.connectHalfedgeToNode(prevheidx, startnidx);

    this.entryHalfedgeIdxArray.push(prevheidx);
  }

  var contourNodeCount = nodes.length; // for debugging; todo: remove
  console.log("halfedge count", halfedges.length);

  var SLAV = this.makeSLAV();

  // pq retrieves smallest-L node first
  var pqComparator = function (a, b) { return a.L - b.L; }
  var pq = new PriorityQueue({ comparator: pqComparator });

  // init priority queue with every precalculated intersection
  for (var LAV of SLAV) {
    var lcurr = LAV;
    do {
      if (lcurr.intersection) pq.queue(lcurr);

      // border verts; todo: remove
      var vv = lcurr.v.clone();
      addDebugVertex(vv.add(lcurr.bisector.clone().multiplyScalar(-0.2)));

      lcurr = lcurr.next;
    } while (lcurr != LAV);
  }

  // iterate, build the straight skeleton
  var ct = 0;
  var ixn = null;
  var dbg = true;
  while (pq.length > 0) {
    if (++ct > 2) break;
    var lnode = pq.dequeue();

    if (dbg && true) {
      console.log('\n');
      console.log(ct, "current:", lnode);
    }

    // intersection vertex
    var vI = lnode.intersection;

    // the two nodes that caused the intersection; lnodeB is CCW from lnodeA
    var lnodeA, lnodeB;
    if (lnode.intersectprev) {
      lnodeA = lnode.prev;
      lnodeB = lnode;
    }
    else {
      lnodeA = lnode;
      lnodeB = lnode.next;
    }
    // now intersection is formed by bisectors of A and B (B CCW from A)

    // dequeued a duplicate intersection, so continue
    if (lnodeA.processed || lnodeB.processed) {
      if (dbg && true) {
        console.log(" discard", lnodeA, lnodeB);
        console.log(" next:", pq.peek());
      }
      continue;
    }

    // reached a peak of the roof
    if (lnodeA.prev.prev == lnodeB) {
      // todo
      if (dbg && true) {
        console.log(" peak", lnodeA, lnodeB, lnodeB.next);
      }
      continue;
    }

    // insert the intersection vertex into the skeleton

    // node at intersection
    var nidxI = this.makeNode(vI);
    // halfedge going into A
    var heidxA = this.halfedgePrevIdx(lnodeA.heidx);
    // vertex node at B
    var nidxB = this.halfedgeNodeIdx(lnodeB.heidx);

    // connect (halfedge going into A) to (node at intersection)
    var heidxAI = this.connectHalfedgeToNode(heidxA, nidxI);
    // connect (halfedge going into intersection) to (node at B)
    var heidxIB = this.connectHalfedgeToNode(heidxAI, nidxB);

    lnodeA.processed = true;
    lnodeB.processed = true;

    // make a new LAV node
    var lnodeI = this.makeLAVnode(heidxIB);
    // todo: remove
    ixn = lnodeI;

    // associate with the correct contour edges
    lnodeI.backward = lnodeA.backward;
    lnodeI.backwardStart = lnodeA.backwardStart;
    lnodeI.forward = lnodeB.forward;
    lnodeI.forwardStart = lnodeB.forwardStart;

    // attach to neighbor LAV nodes
    var newprev = lnodeA.prev;
    var newnext = lnodeB.next;
    newprev.next = lnodeI;
    lnodeI.prev = newprev;
    newnext.prev = lnodeI;
    lnodeI.next = newnext;

    // calculate bisector from contour edges and the resulting intersection,
    // if any, with neighboring LAV nodes' bisectors
    this.calculateBisector(lnodeI);
    this.calculateBisectorIntersection(lnodeI);

    // if intersection, push to PQ
    if (lnodeI.intersection) pq.queue(lnodeI);

    if (dbg && true) {
      console.log(lnodeA, lnodeI, lnodeB);
      console.log(" next:", pq.peek());
    }
  }

  // read off the current priority queue
  var pqct = 0;
  if (dbg && false) {
    while (pq.length > 0) {
      var node = pq.dequeue();
      console.log(pqct, node.L, node.intersection);
      var intersection = node.intersection;
      debugLine(node.v, intersection);
      debugLine(node.intersectprev ? node.prev.v : node.next.v, intersection);
      if (pqct==0) {
        intersection = intersection.clone();
        intersection.z += 0.1;
        addDebugVertex(intersection);
      }
      pqct++;
    }
    debugLines();
  }

  // debug all halfedges of skeleton
  if (dbg && false) {
    for (var i=0; i<halfedges.length; i++) {
      var v = this.nodeVertex(this.halfedgeNodeIdx(i));
      var vv = this.nodeVertex(this.halfedgeEndNodeIdx(i));
      debugLine(v, vv);
    }
    debugLines();
  }

  // debug edges from internal verts of skeleton
  if (dbg && true) {
    for (var i=contourNodeCount; i<nodes.length; i++) {
      var heidx = nodes[i].heidx;
      var c = heidx;
      do {
        var v = this.nodeVertex(this.halfedgeNodeIdx(c));
        var vv = this.nodeVertex(this.halfedgeEndNodeIdx(c));
        debugLine(v, vv);
        c = this.halfedgeCycleIdx(c);
      } while (c != heidx);

      debugLines(i, 2);
    }
  }

  // debug internal verts of skeleton by tracing the faces between these verts
  // and contour edges
  if (dbg && false) {
    for (var i=contourNodeCount; i<nodes.length; i++) {
      var heidx = this.halfedgeTwinIdx(nodes[i].heidx);
      var c = heidx;
      var contourcount = 0;
      do {
        if (halfedges[heidx].contour) contourcount++;;
        c = this.halfedgeNextIdx(c);
      } while (c != heidx);

      if (contourcount>1) heidx = this.halfedgeTwinIdx(heidx);

      c = heidx;
      do {
        var v = this.nodeVertex(this.halfedgeNodeIdx(c));
        var vnext = this.nodeVertex(this.halfedgeEndNodeIdx(c));
        debugLine(v, vnext, 1, true);

        c = this.halfedgeNextIdx(c);
      } while (c != heidx);

      debugLines(i, 2);
    }
  }

  // debug current LAV
  if (dbg && true && ixn) {
    var c = ixn;
    var cct = 0;
    do {
      var a = c.v.clone().add(c.bisector.clone().multiplyScalar(0.1));
      a.z += 0.02;
      addDebugVertex(a);
      debugLine(c.v, c.next.v);
      c = c.next;
      //if (++cct > 100) break;
    } while (c != ixn);
    debugLines();
  }
}

// prefixes 's' and 't' mean "source" and "target"
// 'n' and 'he' signify "node" and "halfedge"
// 'idx' suffix means the index of a node/halfedge, while its absence signifies
// the object itself
//
// halfedge s_he is assumed to terminate with vertex node s_n - say that
// halfedges s_he and s_henext go into it and out, respectively (they may
// be twins);
// t_n may or may not have a next and a previous edge - if it does, they are
// called t_he and t_henext
//
// create 2 new halfedges st_he and ts_he as twins, with s_n as st_he's node and
// t_n as ts_he's node, and splice them in thus:
//
// s_he's next is now st_he ending at t_n
// if t_n has a next edge t_henext, set that as st_he's next;
// else, set ts_he as st_he's next
// ts_he's next is s_henext
StraightSkeleton.prototype.connectHalfedgeToNode = function(s_heidx, t_nidx) {
  var nodes = this.nodes;
  var halfedges = this.halfedges;

  // get source node and outflowing halfedge
  var s_henextidx = this.halfedgeNextIdx(s_heidx);
  var s_nidx = this.halfedgeNodeIdx(s_henextidx);

  // get outflowing and inflowing halfedges for target
  var t_henextidx = this.nodeHalfedgeIdx(t_nidx);
  var t_heidx = -1;
  // if t_n already has an outflowing edge, it must have an inflowing edge too
  if (t_henextidx > -1) {
    t_heidx = this.halfedgePrevIdx(t_henextidx);
  }

  // create two halfedges
  var st_heidx = this.makeHalfedgePair(s_nidx, t_nidx);
  var ts_heidx = this.halfedgeTwinIdx(st_heidx);

  // attach halfedge on source
  this.setHalfedgeNextIdx(s_heidx, st_heidx);
  this.setHalfedgeNextIdx(ts_heidx, s_henextidx);

  // attach halfedges on target
  // if target had outflowing and inflowing edges
  if (t_heidx > -1) {
    this.setHalfedgeNextIdx(st_heidx, t_henextidx);
    this.setHalfedgeNextIdx(t_heidx, ts_heidx);
  }
  // else, if target didn't have edges, we already created the new edges
  // connected to each other - so do nothing

  return st_heidx;
}

// create a node and return it index
StraightSkeleton.prototype.makeNode = function(v) {
  var node = {
    v: v,
    heidx: -1,
    edge: null
  };
  var nidx = this.nodes.length;

  this.nodes.push(node);

  return nidx;
}

// create a loop of two halfedges from s to t and return the st halfedge's index
StraightSkeleton.prototype.makeHalfedgePair = function(s_nidx, t_nidx) {
  var st_heidx = this.halfedges.length;
  var ts_heidx = st_heidx + 1;

  var sv = this.nodeVertex(s_nidx);
  var tv = this.nodeVertex(t_nidx);
  var st_edge = tv.clone().sub(sv);
  var ts_edge = st_edge.clone().negate();

  // s -> t halfedge
  var st_he = {
    nodeidx: s_nidx,
    nextidx: ts_heidx,
    twinidx: ts_heidx,
    edge: st_edge
  };
  // t -> s halfedge
  var ts_he = {
    nodeidx: t_nidx,
    nextidx: st_heidx,
    twinidx: st_heidx,
    edge: ts_edge
  };

  this.halfedges.push(st_he);
  this.halfedges.push(ts_he);

  // in case the node has no halfedge, set it to the most recent halfedge
  this.nodes[s_nidx].heidx = st_heidx;

  return st_heidx;
}

// LAV: list of active vertices (technically, halfedges originating from the
// active vertices), one for each contour
// SLAV: set of LAVs - the current fronts for propagating the skeleton
//
// returns a SLAV, initialized to correspond to the initial contours of the poly
// and its holes
StraightSkeleton.prototype.makeSLAV = function() {
  var SLAV = new Set();

  for (var i=0; i<this.entryHalfedgeIdxArray.length; i++) {
    var entryidx = this.entryHalfedgeIdxArray[i];

    var LAV = null;
    var lstart = null;

    var heidx = entryidx;
    do {
      // LAV node, implicitly signifies vertex at start of given halfedge
      var lnode = this.makeLAVnode(heidx);

      if (LAV) {
        lnode.prev = LAV;
        LAV.next = lnode;
      }
      else lstart = lnode;

      LAV = lnode;

      heidx = this.halfedgeNextIdx(heidx);
    } while (heidx != entryidx);

    LAV.next = lstart;
    lstart.prev = LAV;

    var lcurr;

    // calculate forward and backward edges
    lcurr = LAV;
    do {
      this.calculateOutgoingEdge(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != LAV);

    // calculate bisectors
    lcurr = LAV;
    do {
      this.calculateBisector(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != LAV);

    // calculate bisector intersections
    lcurr = LAV;
    do {
      this.calculateBisectorIntersection(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != LAV);

    SLAV.add(LAV);
  }

  return SLAV;
}

StraightSkeleton.prototype.calculateOutgoingEdge = function(lnode) {
  var v = lnode.v;
  var vnext = lnode.next.v;

  var edge = vnext.clone().sub(v).normalize();
  lnode.forward = edge;
  lnode.forwardStart = v;
  lnode.next.backward = edge.clone().negate();
  lnode.next.backwardStart = vnext;
}

StraightSkeleton.prototype.calculateBisector = function(lnode) {
  var forwardEdge = lnode.forward;
  var backwardEdge = lnode.backward;
  lnode.bisector = forwardEdge.clone().add(backwardEdge).normalize();
}

// given a node in the LAV, see which of its neighbors' bisectors it intersects
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

  var iprev = rayRayIntersection(v, vprev, b, bprev, axis);
  var inext = rayRayIntersection(v, vnext, b, bnext, axis);

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
    lnode.intersectprev = true;
    var edgeStart = lnode.forwardStart;
    var edgeEnd = edgeStart.clone().add(lnode.forward);
    lnode.L = distanceToLine(iprev, edgeStart, edgeEnd, axis);
  }
  // intersection with next bisector is closer
  else if (intersectionResult == 2) {
    lnode.intersection = inext;
    lnode.intersectprev = false;
    var edgeStart = lnode.forwardStart;
    var edgeEnd = edgeStart.clone().add(lnode.forward);
    lnode.L = distanceToLine(inext, edgeStart, edgeEnd, axis);
  }
}

StraightSkeleton.prototype.makeLAVnode = function(heidx) {
  return {
    // skeleton halfedge that starts at this vertex
    heidx: heidx,
    v: this.nodeVertex(this.halfedgeNodeIdx(heidx)),
    // prev/next nodes in LAV
    prev: null,
    next: null,
    processed: false,
    // forward edge direction and origin
    forwardEdge: null,
    forwardEdgeStart: null,
    // backward edge direction and origin
    backwardEdge: null,
    backwardEdgeStart: null,
    // intersection stuff
    bisector: null,
    intersection: null,
    // true if closer bisector intersection is from prev node, false if from next
    // (irrelevant if no intersection, in which case .intersection is null)
    intersectprev: true,
    // distance from intersection point to neighboring edge
    L: null
  };
}

StraightSkeleton.prototype.lnodeVertex = function(lnode) {
  return this.nodeVertex(this.halfedgeNodeIdx(lnode.heidx));
}

StraightSkeleton.prototype.lnodeNextVertex = function(lnode) {
  return this.nodeVertex(this.halfedgeEndNodeIdx(lnode.heidx));
}

StraightSkeleton.prototype.lnodePrevVertex = function(lnode) {
  var heprevidx = this.halfedgePrevIdx(lnode.heidx);
  return this.nodeVertex(this.halfedgeNodeIdx(heprevidx));
}

StraightSkeleton.prototype.halfedgeNextIdx = function(heidx) {
  if (heidx == -1) return -1;

  return this.halfedges[heidx].nextidx;
}

StraightSkeleton.prototype.halfedgeNodeIdx = function(heidx) {
  if (heidx == -1) return -1;

  return this.halfedges[heidx].nodeidx;
}

StraightSkeleton.prototype.halfedgeEndNodeIdx = function(heidx) {
  if (heidx == -1) return -1;

  var twinidx = this.halfedgeTwinIdx(heidx);

  return this.halfedgeNodeIdx(twinidx);
}

StraightSkeleton.prototype.halfedgeTwinIdx = function(heidx) {
  if (heidx == -1) return -1;

  return this.halfedges[heidx].twinidx;
}

StraightSkeleton.prototype.halfedgePrevIdx = function(heidx) {
  if (heidx == -1) return -1;

  var curridx = heidx;
  var previdx;

  do {
    previdx = curridx;
    curridx = this.halfedgeNextIdx(this.halfedgeTwinIdx(curridx));
    if (curridx == -1) return -1;
  } while (curridx != heidx);

  return this.halfedgeTwinIdx(previdx);
}

// use to cycle around the halfedges radiating from a vertex node
StraightSkeleton.prototype.halfedgeCycleIdx = function(heidx) {
  if (heidx == -1) return -1;

  return this.halfedgeNextIdx(this.halfedgeTwinIdx(heidx));
}

StraightSkeleton.prototype.nodeNextNodeIdx = function(nidx) {
  if (nidx == -1) return -1;

  return this.halfedgeEndNodeIdx(this.nodes[nidx].heidx);
}

StraightSkeleton.prototype.nodePrevNodeIdx = function(nidx) {
  if (nidx == -1) return -1;

  var heprevidx = this.halfedgePrevIdx(this.nodeHalfedgeIdx(nidx));
  return this.halfedgeNodeIdx(heprevidx);
}

StraightSkeleton.prototype.setHalfedgeNextIdx = function(heidx, henextidx) {
  this.halfedges[heidx].nextidx = henextidx;
}

StraightSkeleton.prototype.setNodeHalfedge = function(nidx, heidx) {
  this.nodes[nidx].heidx = heidx;
}

StraightSkeleton.prototype.nodeHalfedgeIdx = function(nidx) {
  if (nidx == -1) return -1;

  return this.nodes[nidx].heidx;
}

StraightSkeleton.prototype.nodeVertex = function(nidx) {
  if (nidx == -1) return null;

  return this.nodes[nidx].v;
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
