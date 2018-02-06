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

  this.layerVertices = null;

  this.sliceHeight = 0.5;
  this.axis = "z";
  this.mode = "preview";
  this.previewGeometryReady = false;
  this.layerGeometryReady = false;

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
  else if (this.mode=="layer") {
    if (!this.layerGeometryReady) this.makeLayerGeometry();
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
  else if (this.mode=="layer") return {
    vertices: this.layerVertices,
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
  else if (this.mode=="layer") this.setLayerSlice();
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

Slicer.prototype.setLayerSlice = function() {
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

Slicer.prototype.makeLayerGeometry = function() {
  var segmentLists = this.buildLayerSegmentLists();

  this.layerVertices = [];

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

    layer.writeBaseContoursToVerts(this.layerVertices);
    layer.makeSkeletons();
    layerBuilder.clear();
  }

  timer.stop();
  debugPoints();

  this.layerGeometryReady = true;
}



// SLICING THE MESH INTO PATHS

// uses an implementation of "An Optimal Algorithm for 3D Triangle Mesh Slicing"
// http://www.dainf.ct.utfpr.edu.br/~murilo/public/CAD-slicing.pdf

Slicer.prototype.buildLayerLists = function() {
  var sliceHeight = this.sliceHeight;
  var min = this.min, max = this.max;
  var faceBounds = this.faceBounds;

  var numLayers = this.numSlices - 2;

  // position fo first and last layer
  var layer0 = min + sliceHeight/2;
  var layerk = layer0 + sliceHeight * (numLayers - 1);

  // init layer lists
  var layerLists = new Array(numLayers + 1);
  for (var i=0; i<=numLayers; i++) layerLists[i] = [];

  // bucket the faces
  for (var i=0; i<this.sourceFaceCount; i++) {
    var bounds = faceBounds[i];
    var index;

    if (bounds.min < layer0) index = 0;
    else if (bounds.min > layerk) index = numLayers;
    else index = Math.ceil((bounds.min - layer0) / sliceHeight);

    layerLists[index].push(i);
  }

  return layerLists;
}

Slicer.prototype.buildLayerSegmentLists = function() {
  var layerLists = this.buildLayerLists();

  // various local vars
  var numLayers = layerLists.length;
  var faceBounds = this.faceBounds;
  var min = this.min, axis = this.axis;
  var sliceHeight = this.sliceHeight;
  var vertices = this.sourceVertices;
  var faces = this.sourceFaces;

  var layerSegmentLists = new Array(numLayers);

  // running set of active face indices as we sweep up along the layers
  var sweepSet = new Set();

  for (var i=0; i<numLayers; i++) {
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
    //if (i!=0) continue; // todo: remove
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

  // eliminate collinear vertices and update bounds
  start = null;
  var current = this.vertex;
  do {
    if (this.collinear(current)) {
      this.removeNode(current);
    }
    else {
      if (!start) start = current;
      this.updateBounds(current);
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
  var debugMaterial = new THREE.PointsMaterial( { color: 0xff0000, size: 3, sizeAttenuation: false });
  var debugMesh = new THREE.Points(debugGeo, debugMaterial);
  debugMesh.name = "debug";
  scene.add(debugMesh);

  debugGeo = new THREE.Geometry();
}
function debugLines(idx, incr) {
  var color = 0xff6666;
  if (incr===undefined) incr = 0;
  if (idx!==undefined) {
    color = parseInt(('0.'+Math.sin(idx+incr).toString().substr(6))*0xffffff);
    //console.log("%c idx "+idx, 'color: #'+color.toString(16));
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



SSNode = function(v, L) {
  this.id = -1;
  // vertex
  this.v = v;
  // one of the 1+ halfedges starting at this node
  this.halfedge = null;
  // true if reflex contour vertex
  this.reflex = false;
  // the "time" at which this node was formed
  this.L = L !== undefined ? L : 0;
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

SSNodeFactory.prototype.create = function(v, L) {
  var node = new SSNode(v, L);

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
  this.id = -1;

  this.he = he;

  var start = he.nstart().v;
  var end = he.nend().v;

  this.start = start;
  this.end = end;

  this.forward = end.clone().sub(start).normalize();
  this.backward = this.forward.clone().negate();

  // set of LAV node IDs for nodes that have this edge as their forward edge
  this.lnodes = new Set();
}

SSEdge.prototype.addNode = function(lnode) {
  this.lnodes.add(lnode.id);
}

SSEdge.prototype.removeNode = function(lnode) {
  this.lnodes.delete(lnode.id);
}

SSEdge.prototype.replaceNode = function(lnodeOld, lnodeNew) {
  this.removeNode(lnodeOld);
  this.addNode(lnodeNew);
}

SSEdgeFactory = function() {
  this.id = 0;
}

SSEdgeFactory.prototype.create = function(he) {
  var edge = new SSEdge(he);

  edge.id = this.id++;

  return edge;
}



// represents a node in a circular, double-linked list of active vertices
SSLAVNode = function(he) {
  this.id = -1;

  // skeleton halfedge that starts at this vertex
  this.he = he;
  // for ease of access
  this.v = he.node.v;
  this.L = he.node.L;
  this.reflex = he.node.reflex;

  // prev/next nodes in lav
  this.prev = null;
  this.next = null;

  // flag - true means that the vert will not take part in further events
  this.processed = false;

  // forward and backward edges
  this.ef = null;
  this.eb = null;

  // normalized bisecting vector
  this.bisector = null;
}

SSLAVNode.prototype.setProcessed = function() {
  // unlink this LAV node's edge from this node
  this.ef.removeNode(this);
  // set flag
  this.processed = true;
}

SSLAVNode.prototype.setEdgeForward = function(edge) {
  // unlink the current LAV node from this edge
  if (this.ef) this.ef.removeNode(this);
  // link this LAV node to the edge
  edge.addNode(this);
  // set edge
  this.ef = edge;
}

SSLAVNode.prototype.setEdgeBackward = function(edge) {
  // set backward edge
  this.eb = edge;
}

SSLAVNodeFactory = function() {
  this.id = 0;
  this.lnodes = [];
}

SSLAVNodeFactory.prototype.create = function(he) {
  var lnode = new SSLAVNode(he);

  this.lnodes.push(lnode);
  lnode.id = this.id++;

  return lnode;
}



// basically an enum we'll use to bitmask
var SSEventTypes = {
  noEvent: 0,
  edgeEvent: 1,
  splitEvent: 2,
  startSplitEvent: 4,
  endSplitEvent: 8
}

SSEvent = function(lnode) {
  this.type = SSEventTypes.noEvent;

  this.lnode = lnode;

  // intersection point (edge and split events); null if no intersection
  this.intersection = null;

  // distance from event point to all edges involved in the event
  this.L = Infinity;

  // event type - either edge or split, edge by default
  this.type = SSEventTypes.noEvent;
  // the other node involved in an event:
  // if edge event, this is the neighbor node that intersects the bisector;
  // if split event, this is node A such that the split edge starts at A
  this.otherNode = null;
}

// straight skeleton uses a halfedge data structure; initialize from a polygon
// with holes so that initial halfedges wind CCW around interior of every
// contour and CW around the exterior of every contour;
// poly is assumed a closed, simple CCW contour with holes
//
// this implementation is based on Petr Felkel's paper with the addition of
// special "start" and "end" split events, in which a split event falls exactly
// on one of the split edge's bisectors (CGAL refers to these as "pseudo split
// events"), IIRC
StraightSkeleton = function(poly) {
  var axis = poly.axis;
  var epsilon = poly.epsilon !== undefined ? poly.epsilon : 0.0000001;

  this.axis = axis;
  this.ah = poly.ah;
  this.av = poly.av;
  this.epsilon = epsilon;

  // used for optimization
  this.hasHoles = poly.holes.length > 0;

  // array of halfedges, one per separate contour
  this.entryHalfedges = [];

  this.nfactory = new SSNodeFactory();
  this.hefactory = new SSHalfedgeFactory();
  this.connector = new SSConnector(this.nfactory, this.hefactory);
  this.lfactory = new SSLAVNodeFactory();
  this.efactory = new SSEdgeFactory();

  this.makePQ();

  this.buildContour(poly);

  this.buildInterior();
}

StraightSkeleton.prototype.makePQ = function() {
  // pq retrieves smallest-L node first
  var pqComparator = function (a, b) { return a.L - b.L; }

  this.pq = new PriorityQueue({
    comparator: pqComparator,
    // using BHeap instead of the default because the default exhibits strange
    // behavior I can't reproduce in a controlled environment - an occasional
    // event would come off the PQ out of order.
    // I'd assumed this was because I originally used LAV nodes to store events,
    // so I could end up recalculating an event on the same object and pushing
    // it to the PQ twice, but apparently this still happens even if I wrap the
    // LAV nodes in event objects that are created for every recalculation.
    // so I dunno.
    strategy: PriorityQueue.BHeapStrategy
  });
}

StraightSkeleton.prototype.queueEvent = function(event) {
  if (event.type != SSEventTypes.noEvent) this.pq.queue(event);
}

// make the contour nodes + halfedges
StraightSkeleton.prototype.buildContour = function(poly) {
  var nfactory = this.nfactory;
  var connector = this.connector;

  var nodes = nfactory.nodes;

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

      var n = nfactory.create(v, 0);
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
}

// process events and fill out the internal nodes + halfedges
StraightSkeleton.prototype.buildInterior = function() {
  var axis = this.axis;
  var epsilon = this.epsilon;

  var pq = this.pq;

  var nfactory = this.nfactory;
  var hefactory = this.hefactory;
  var connector = this.connector;
  var lfactory = this.lfactory;

  var contourNodeCount = nfactory.nodes.length; // todo: remove

  var lnodes = lfactory.lnodes;

  var slav = this.makeslav();

  this.calculateInitialEvents(slav);

  var ct = 0;
  var lim = 227 ;
  var t = true, f = false;
  var limitIterations = t;
  var skeletonShiftDistance = -0.1;
  var iterativelyShiftSkeleton = f;
  var validate = t;

  var prevL = 0;

  while (pq.length > 0) {
    ct++;
    if (limitIterations && ct > lim) break;

    var event = pq.dequeue();

    if (less(event.L, prevL, epsilon)) console.log("EVENT IN WRONG ORDER", prevL, event.L);
    prevL = Math.max(prevL, event.L);

    var lnodeV = event.lnode;

    if (validate) {
      var validated = true;
      validated = validateEdges(this.edges, lnodes);
      if (!validated) {
        console.log(ct);
        break;
      }

      validated = validateLAV(lnodeV);
      if (!validated) {
        console.log(ct);
        break;
      }
    }

    var logEvent = t;
    var debugResultLav = t;

    var eventType = event.type;

    if (eventType == SSEventTypes.noEvent) continue;

    var vI = event.intersection;
    var lnodeE = event.otherNode;

    if (eventType & SSEventTypes.edgeEvent) {
      if (logEvent) console.log(ct, "edge event", event.L);
      // in edge event, V's bisector intersects one of its neighbors' bisectors,
      // resulting in the collapse of the edge between them to an internal
      // straight skeleton node

      // set the two nodes such that B is CCW from A
      var lnodeA, lnodeB;

      // if E CW of V
      if (lnodeE == lnodeV.prev || lnodeE.next == lnodeV) {
        lnodeA = lnodeE;
        lnodeB = lnodeV;
      }
      // if V CW of E
      else if (lnodeV == lnodeE.prev || lnodeV.next == lnodeE) {
        lnodeA = lnodeV;
        lnodeB = lnodeE;
      }
      else {
        if (logEvent) console.log("NODES DON'T MATCH, DISCARD");
        continue;
      }

      var procA = lnodeA.processed;
      var procB = lnodeB.processed;

      if (ct >= lim) {
        debugPt(lnodeA.v, 0.1, true);
        debugPt(lnodeB.v, 0.2, true);
        //debugLAV(procA ? lnodeB : lnodeA, 2, 250, true, 0);
      }

      if (logEvent && (procA && procB)) console.log("DISCARD");
      if (procA && procB) continue;

      var lnodeI;

      // if A is processed and B is not processed
      if (procA) {
        if (logEvent) console.log("A PROCESSED");

        lnodeI = lnodeB.prev;
        if (less(lnodeI.L, lnodeB.L, epsilon)) continue;

        // connect
        lnodeI.next = lnodeB.next;
        lnodeB.next.prev = lnodeI;

        lnodeI.setEdgeForward(lnodeB.ef);
        lnodeB.setProcessed();

        lnodeI.he = connector.connectHalfedgeToHalfedge(lnodeB.he, lnodeI.he);
      }
      // if A is not processed and B is processed
      else if (procB) {
        if (logEvent) console.log("B PROCESSED");

        lnodeI = lnodeA.next;
        if (less(lnodeI.L, lnodeA.L, epsilon)) continue;

        lnodeI.prev = lnodeA.prev;
        lnodeA.prev.next = lnodeI;

        lnodeI.setEdgeBackward(lnodeA.eb);
        lnodeA.setProcessed();

        connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeI.he);
      }
      else {
        if (lnodeB.next == lnodeA) {
          if (logEvent) console.log("2-NODE LAV, CONTINUE");
          connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeB.he);
          lnodeA.setProcessed();
          lnodeB.setProcessed();

          continue;
        }

        // new node at intersection
        var nI = nfactory.create(vI, event.L);

        // link A to I
        var heA = lnodeA.he;
        var heIA = connector.connectHalfedgeToNode(heA, nI);
        lnodeA.setProcessed();

        // link B to I
        var heB = lnodeB.he;
        var heIB = connector.connectHalfedgeToHalfedge(heB, heIA);
        lnodeB.setProcessed();

        // reached a peak of the roof, so close it with a third halfedge
        if (lnodeA.prev.prev == lnodeB) {
          if (logEvent) console.log("PEAK");
          var lnodeC = lnodeA.prev;
          var heC = lnodeC.he;

          connector.connectHalfedgeToHalfedge(heC, heIB);
          lnodeC.setProcessed();

          continue;
        }

        // make a new LAV node at the intersection
        lnodeI = lfactory.create(heIB);

        var newprev = lnodeA.prev;
        var newnext = lnodeB.next;
        newprev.next = lnodeI;
        lnodeI.prev = newprev;
        newnext.prev = lnodeI;
        lnodeI.next = newnext;

        lnodeI.setEdgeForward(lnodeB.ef);
        lnodeI.setEdgeBackward(lnodeA.eb);
      }

      var eventI = new SSEvent(lnodeI);
      this.calculateBisector(lnodeI);
      this.calculateEdgeEvent(eventI);
      this.queueEvent(eventI);

      if (ct >= lim) {
        debugLAV(lnodeI, 2, 250, true, 0);
        debugPt(eventI.intersection, 0.5, true);
      }
    }

    else if (eventType & SSEventTypes.splitEvent) {
      if (logEvent) {
        var logstring = "split event";
        if (eventType & SSEventTypes.startSplitEvent) logstring += " START";
        if (eventType & SSEventTypes.endSplitEvent) logstring += " END";
        console.log(ct, logstring, event.L);
      }
      // in split event, V's bisector causes a given A-B edge to split.
      // the new node structure looks like this:
      //
      // B---A
      //  *?*
      //   I
      //   |
      //   V
      //  / \
      // P   N
      // where the original LAV went P -> V -> N -> ... -> A -> B -> ... -> P; we
      // create an I hanging off the V, splitting the LAV on either side of I.
      // In the following:
      // "right" denotes the ... -> P -> I -> B -> ... sequence and
      // "left" denotes the ... -> A -> I -> N -> ... sequence
      // except for the special cases where I is directly on the bisector of
      // A, B, or both (referred to as start split and end split, respectively)

      if (ct >= lim) {
        debugPt(lnodeV.v, 0.1, true);
        debugLn(lnodeE.ef.start, lnodeE.ef.end, 0.4, 0);
      }

      if (logEvent && lnodeV.processed) console.log("DISCARD");
      if (lnodeV.processed) continue;

      // true if intersection is on the start/end bisectors, respectively
      var startSplit = !!(eventType & SSEventTypes.startSplitEvent);
      var endSplit = !!(eventType & SSEventTypes.endSplitEvent);

      // the edge that's split
      var edge = lnodeE.ef;

      var lnodeA = lnodeE;

      // see which LAV nodes F are associated with the edge - choose one of
      // these to split
      for (var lidx of edge.lnodes) {
        var lnodeF = lnodes[lidx];
        var lnodeS = lnodeF.next;
        var vF = lnodeF.v;
        var vS = lnodeS.v;
        var vFoffset = vF.clone().add(lnodeF.bisector);
        var vSoffset = vS.clone().add(lnodeS.bisector);

        // intersection must be within the sweep area between F and S
        if (left(vF, vFoffset, vI, axis, epsilon)) continue;
        if (left(vSoffset, vS, vI, axis, epsilon)) continue;

        lnodeA = lnodeF;
        break;
      }

      var lnodeB = lnodeA.next;

      if (ct >= lim) {
        debugPt(lnodeA.v, 0.2, true);
        debugPt(lnodeB.v, 0.2, true);
        debugPt(vI, 0.3, true);
      }

      if (logEvent && (lnodeA.processed && lnodeB.processed)) console.log("UPDATE: DISCARD");
      if (lnodeA.processed && lnodeB.processed) continue;

      // V's predecessor and successor
      var lnodeP = lnodeV.prev;
      var lnodeN = lnodeV.next;

      // put a new skeleton vertex node at split point
      var nI = nfactory.create(vI, event.L);

      // halfedge from V
      var heV = lnodeV.he;

      // connect V to I
      var heIV = connector.connectHalfedgeToNode(heV, nI);
      lnodeV.setProcessed();

      // split the LAV in two by creating two new LAV nodes at the intersection
      // and linking their neighbors and the split edge's endpoints accordingly

      // new LAV node on the A-N side of I (right node is always at the start
      // of the IV halfedge)
      var lnodeRight = lfactory.create(heIV);
      // new LAV node on the M-B side of I
      var lnodeLeft = null;

      // if intersection is on A or B bisector, link I to one or both and make
      // the left LAV node accordingly
      if (startSplit && endSplit) {
        var heIA = connector.connectHalfedgeToHalfedge(lnodeA.he, heIV);
        var heIB = connector.connectHalfedgeToHalfedge(lnodeB.he, heIA);
        lnodeLeft = lfactory.create(heIB);
      }
      else if (startSplit) {
        var heIA = connector.connectHalfedgeToHalfedge(lnodeA.he, heIV);
        lnodeLeft = lfactory.create(heIA);
      }
      else if (endSplit) {
        var heIB = connector.connectHalfedgeToHalfedge(lnodeB.he, heIV);
        lnodeLeft = lfactory.create(heIB);
      }
      else {
        lnodeLeft = lfactory.create(heIV);
        // note to self: bug here? heIV is on the A-N side, so we might break
        // the edge flow if we try to connect on the P-B side to heIV.
        // possibly fix by tracking the *incoming* halfedge instead and, when we
        // try to connect to a LAV node with such an edge, use its next instead.
        // shouldn't be important for offsetting, though.
      }

      // link the new LAV nodes accounting for the possibility that A and/or B
      // were eliminated by an exact bisector intersection

      // I's neighbors depend on whether a start/end split occurred
      // prev node on A-I-N side
      var lnodeRPrev = startSplit ? lnodeA.prev : lnodeA;
      // next node on P-I-B side
      var lnodeLNext = endSplit ? lnodeB.next : lnodeB;

      // link A-N side of I
      lnodeRPrev.next = lnodeRight;
      lnodeRight.prev = lnodeRPrev;
      lnodeN.prev = lnodeRight;
      lnodeRight.next = lnodeN;

      // link P-B side of I
      lnodeP.next = lnodeLeft;
      lnodeLeft.prev = lnodeP;
      lnodeLNext.prev = lnodeLeft;
      lnodeLeft.next = lnodeLNext;

      // A and/or B can be eliminated by start/end split
      if (startSplit) lnodeA.setProcessed();
      if (endSplit) lnodeB.setProcessed();

      lnodeRight.setEdgeForward(lnodeV.ef);
      lnodeRight.setEdgeBackward(startSplit ? lnodeA.eb : lnodeA.ef)
      lnodeLeft.setEdgeForward(endSplit ? lnodeB.ef : lnodeB.eb);
      lnodeLeft.setEdgeBackward(lnodeP.ef);

      this.calculateReflex(lnodeRight);
      this.calculateBisector(lnodeRight);
      this.calculateReflex(lnodeLeft);
      this.calculateBisector(lnodeLeft);

      // final processing:
      // 1. if V is adjacent to A/B, link A/B to the right/left node, resp.;
      // 2. if one or both of the split LAVs incident on I ended up being
      // degenerate (containing only two verts), just link those two verts with
      // a halfedge;
      // 3. else, calculate bisectors and potential new events

      // A-N side of I
      if (lnodeN == lnodeA) {
        connector.connectHalfedgeToHalfedge(lnodeA.he, lnodeRight.he);
        lnodeA.setProcessed();
        lnodeRight.setProcessed();
        console.log("right split empty");
      }
      /*else if (lnodeRight.prev == lnodeRight.next) {
        connector.connectHalfedgeToHalfedge(heIV, lnodeRight.prev.he);

        lnodeRight.ef.removeNode(lnodeRight);
        lnodeRight.prev.ef.removeNode(lnodeRight.prev);
        lnodeRight.processed = true;
        lnodeRight.prev.processed = true;
      }*/
      // else, update bisectors and events
      else {
        var eventRight = new SSEvent(lnodeRight);
        this.calculateEdgeEvent(eventRight);
        this.queueEvent(eventRight);
      }

      // P-B side of I
      if (lnodeP == lnodeB) {
        connector.connectHalfedgeToHalfedge(lnodeB.he, lnodeLeft.he);
        lnodeB.setProcessed();
        lnodeLeft.setProcessed();
        console.log("left split empty");
      }
      /*else if (lnodeLeft.next == lnodeLeft.prev) {
        connector.connectHalfedgeToHalfedge(heIV.twin.next, lnodeLeft.next.he);
        lnodeLeft.ef.removeNode(lnodeLeft);
        lnodeLeft.next.ef.removeNode(lnodeLeft.next);
        lnodeLeft.processed = true;
        lnodeLeft.next.processed = true;
      }*/
      else {
        var eventLeft = new SSEvent(lnodeLeft);
        this.calculateEdgeEvent(eventLeft);
        this.queueEvent(eventLeft);
      }

      if (ct >= lim) {
        if (lnodeN != lnodeA) debugLAV(lnodeRight, 7, 250, true, 0.02)
        if (lnodeP != lnodeB) debugLAV(lnodeLeft, 6, 250, true, 0.02);
      }
    }
  }

  debugSkeleton();

  function debugPQ() {
    while (pq.length>0) {
      var event = pq.dequeue();
      var lnodeV = event.lnode;
      var lnodeE = event.otherNode;

      var lnodeA, lnodeB;

      // if E CW of V
      if (lnodeE == lnodeV.prev || lnodeE.next == lnodeV) {
        lnodeA = lnodeE;
        lnodeB = lnodeV;
      }
      // if V CW of E
      else if (lnodeV == lnodeE.prev || lnodeV.next == lnodeE) {
        lnodeA = lnodeV;
        lnodeB = lnodeE;
      }

      debugLn(lnodeA.v, event.intersection, 2, 2);
      debugLn(lnodeB.v, event.intersection, 2, 2);
    }
  }

  function debugSkeleton() {
    var offset = skeletonShiftDistance;
    var nodes = nfactory.nodes;
    for (var i=contourNodeCount; i<nodes.length; i++) {
      var node = nodes[i];

      var he = node.halfedge;
      do {
        var vs = node.v.clone();
        var ve = he.nend().v.clone();
        vs.z += offset;
        ve.z += offset;
        debugLine(vs, ve);

        he = he.rotated();
      } while (he != node.halfedge);
      if (iterativelyShiftSkeleton) offset += -0.1;
    }
    debugLines();
  }

  function validateEdges(edges, lnodes) {
    var valid = true;

    for (var e=0; e<edges.length; e++) {
      var edge = edges[e];
      for (var lidx of edge.lnodes) {
        var lnode = lnodes[lidx];
        if (lnode.ef!=edge) {
          valid = false;
          console.log("WRONG EDGE ON NODE", lnode, edge);
          debugLn(lnode.v, lnode.next.v, 0.2, 1);
          debugLn(edge.start, edge.end, 0.4, 2);
        }
      }
    }

    for (var l=0; l<lnodes.length; l++) {
      var lnode = lnodes[l];
      if (lnode.processed) continue;

      var ef = lnode.ef;
      if (!ef.lnodes.has(lnode.id)) {
        valid = false;
        console.log("NODE NOT PRESENT IN EDGE'S SET", lnode, ef);
        debugLn(lnode.v, lnode.next.v, 0.2, 1, true);
        debugLn(ef.start, ef.end, 0.4, 2);
      }
    }

    return valid;
  }

  function validateLAV(start) {
    var valid = true;
    var seen = new Set();

    if (start.processed) return true;

    var lnode = start;
    do {
      if (seen.has(lnode.id)) {
        console.log("LOOP WITH NODE", lnode.id);
        valid = false;
        break;
      }

      if (lnode.next.prev != lnode) {
        console.log("BRANCH AT NODE", lnode.id);
        valid = false;
        break;
      }

      seen.add(lnode.id);
      lnode = lnode.next;
    } while (lnode != start);

    return valid;
  }

  function debugPt(v, o, includeStart, c) {
    if (o===undefined) o = 0;
    if (c===undefined) c = 0;

    var vcopy = v.clone();
    vcopy.z += o;
    debugVertex(vcopy);

    if (includeStart) {
      debugLine(v, vcopy);
    }
    debugLines(c);
  }

  function debugLn(v, w, o, c, dir) {
    if (o===undefined) o = 0;
    if (c===undefined) c = 0;

    var vcopy = v.clone();
    var wcopy = w.clone();
    vcopy.z += o;
    wcopy.z += o;

    if (dir) debugLine(vcopy, wcopy, 10, true);
    else debugLine(vcopy, wcopy);
    debugLines(c);
  }

  function debugRay(v, r, o, c, l, dir) {
    var bp = r.clone().setLength(l);
    var vo = v.clone().add(bp);
    debugLn(v, vo, o, c, dir);
  }

  function debugLAV(lnode, c, maxct, bisectors, increment, edges) {
    if (maxct === undefined) maxct = Infinity;
    if (increment === undefined) increment = 0.05;

    if (lnode.processed) return;

    var dct = 0;
    if (debugResultLav) {
      var o = 0;
      var lv = lnode;
      do {
        c = c===undefined ? 0 : c;
        debugLn(lv.v, lv.next.v, o, c, false);
        //debugPt(lv.v, o-increment, true, c);
        if (bisectors && lv.bisector) debugRay(lv.v, lv.bisector, o, c+2, 0.1);
        if (edges) {
          var edgeCenter = lv.ef.start.clone().add(lv.ef.end).multiplyScalar(0.5);
          debugLn(lv.v, edgeCenter, o, c+3, true);
        }

        lv = lv.next;
        o += increment;
        if (++dct > maxct) {
          console.log("debugging LAV node", lv.id, "went over the limit", maxct);
          break;
        }
      } while (lv != lnode);
    }
  }

  function debugEdge(edge, c, oo) {
    if (oo===undefined) oo = 0;

    var ddct = 0;
    for (var lx of edge.lnodes) {
      ddct++;
      var lnode = lnodes[lx];
      //debugPt(lnode.v, -0.1*ddct);
      debugLAV(lnode, c, 250, true, oo);
    }
    console.log(ddct);
  }

  function debugEvent(lnode) {
    var evt = lnode.eventType;
    var en = lnode.otherNode;
    if (evt&SSEventTypes.edgeEvent) {
      debugPt(lnode.v, -0.1, true, 0);
      debugPt(en.v, -0.1, true, 0);
      var eef = en.ef;
      debugLn(eef.start, eef.end, -0.1, 0, true);
      debugPt(lnode.intersection, -0.2, true, 0);
    }
    else if (evt&SSEventTypes.splitEvent) {
      debugPt(lnode.v, -0.2, true, 1);
      var eef = lnode.otherNode.ef;
      debugLn(eef.start, eef.end, -0.2, 1, true);
      debugPt(lnode.intersection, -0.3, true, 1);
    }
  }

  return;
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

    this.edges = []; // todo: remove

    var he = hestart;
    do {
      // lav node, implicitly signifies vertex at start of given halfedge
      var lnode = this.lfactory.create(he);

      if (lav) {
        lnode.prev = lav;
        lav.next = lnode;
      }
      else lstart = lnode;

      lav = lnode;

      // necessary because halfedge is internal to the contour but iterating
      // forward after topology has changed might trap us in a subpolygon of
      // the halfedge data structure
      he = he.twin.prev().twin;
    } while (he != hestart);

    lav.next = lstart;
    lstart.prev = lav;

    var lcurr;

    // calculate forward and backward edges
    lcurr = lav;
    do {
      var edge = this.efactory.create(lcurr.he);
      lcurr.setEdgeForward(edge);
      lcurr.next.setEdgeBackward(edge);
      this.edges.push(edge); // todo: remove

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // set reflex state
    lcurr = lav;
    do {
      this.calculateReflex(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    // calculate bisectors
    lcurr = lav;
    do {
      this.calculateBisector(lcurr);

      lcurr = lcurr.next;
    } while (lcurr != lav);

    slav.add(lav);
  }

  return slav;
}

StraightSkeleton.prototype.calculateReflex = function(lnode) {
  var ef = lnode.ef;
  var eb = lnode.eb;

  lnode.reflex = crossProductComponent(ef.forward, eb.backward, this.axis) < 0;
}

StraightSkeleton.prototype.calculateBisector = function(lnode) {
  var forward = lnode.ef.forward;
  var backward = lnode.eb.backward;
  var bisector = forward.clone().add(backward).normalize();

  if (lnode.reflex) bisector.negate();

  lnode.bisector = bisector;
}

// given a node in the lav, see which of its neighbors' bisectors it intersects
// first (if any)
StraightSkeleton.prototype.calculateEdgeEvent = function(event) {
  var axis = this.axis;

  var lnodeV = event.lnode;
  var v = lnodeV.v;
  var b = lnodeV.bisector;
  var lprev = lnodeV.prev;
  var vprev = lprev.v;
  var bprev = lprev.bisector;
  var lnext = lnodeV.next;
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
    event.intersection = iprev;
    event.otherNode = lprev;
    var edge = lprev.ef;
    event.L = distanceToLine(iprev, edge.start, edge.end, axis);
  }
  // intersection with next bisector is closer
  else if (intersectionResult == 2) {
    event.intersection = inext;
    event.otherNode = lnext;
    var edge = lnodeV.ef;
    event.L = distanceToLine(inext, edge.start, edge.end, axis);
  }

  if (intersectionResult != 0) event.type = SSEventTypes.edgeEvent;
}

// calculates the closest split event caused by V's bisector (if V is reflex);
// if no split event, leave it alone
StraightSkeleton.prototype.calculateSplitEventSLAV = function(event, slav) {
  for (var lav of slav) {
    this.calculateSplitEvent(event, lav);
  }
}

StraightSkeleton.prototype.calculateSplitEvent = function(event, lav) {
  var lnodeV = event.lnode;

  if (!lnodeV.reflex) return;

  var v = lnodeV.v;
  var b = lnodeV.bisector;
  var axis = this.axis;
  var epsilon = this.epsilon;

  var splitPoint = null;
  // node that starts the edge that gets split
  var eventNode = null;
  var minL = Infinity;
  var splitType = 0;

  var lcurr = lav;
  do {
    // say current lnode is A and its next is B; we're considering the edge
    // between A and B through A and B
    var lnodeA = lcurr;
    var lnodeB = lcurr.next;

    lcurr = lcurr.next;

    // lnodeV's bisector will never split either of its incident edges
    if (lnodeA == lnodeV || lnodeB == lnodeV) continue;

    var ef = lnodeA.ef;
    var bA = lnodeA.bisector;
    var bB = lnodeB.bisector;

    var eAB = ef.forward;
    var vA = ef.start;
    var vB = ef.end;

    // the AB edge must "face" the splitting vertex - B left of VA segment
    if (!leftOn(v, vA, vB, axis, epsilon)) continue;

    // now say the forward and backward edges emanating from V intersect the
    // AB line at points R and S (R is closer); find R, draw its bisector with
    // AB line, see where it intersects V's bisector

    // edges emanating from V - *reverse* forward/backward edges, respectively
    var efnV = lnodeV.ef.backward;
    var ebnV = lnodeV.eb.forward;

    // pick the edge that's least parallel with the testing edge to avoid
    // the more parallel edge
    var fndotAB = Math.abs(efnV.dot(eAB));
    var bndotAB = Math.abs(ebnV.dot(eAB));
    var enV = (fndotAB < bndotAB) ? efnV : ebnV;

    // R is intersection point between the edge from V and the AB line
    var vR = lineLineIntersection(v, vA, enV, eAB, axis);

    if (vR === null) continue;

    // vector from R to V
    var eRV = v.clone().sub(vR).normalize();

    // need AB edge pointing from R toward the bisector
    if (left(v, v.clone().add(b), vR, axis)) eAB = ef.backward;

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

    // if the split point is coincident with one (or both) of the edge's
    // bisectors, then V's wavefront doesn't split the edge in two but instead
    // meets it at one (or both) of its ends - this is a special case of the
    // split event and has special handling
    var type = 0;
    if (collinear(vA, vAoffset, vSplit, axis, epsilon)) {
      type = type | SSEventTypes.startSplitEvent;
    }
    if (collinear(vB, vBoffset, vSplit, axis, epsilon)) {
      type = type | SSEventTypes.endSplitEvent;
    }

    // check if split point is on the "interior" side of the edge
    if (!left(vA, vB, vSplit, axis, epsilon)) continue;

    // if split point is not already known to be on one of the bisectors,
    // check if it's between the bisectors bounding the edge's sweep area
    if (type == 0) {
      if (left(vA, vAoffset, vSplit, axis, epsilon)) continue;
      if (left(vBoffset, vB, vSplit, axis, epsilon)) continue;
    }

    // valid split point, so see if it's the closest so far
    var L = distanceToLine(vSplit, vA, vB, axis);

    if (L < minL) {
      minL = L;
      splitPoint = vSplit;
      eventNode = lnodeA;
      splitType = type;
    }
  } while (lcurr != lav);

  // if the closest split event we found is closer than the edge event already
  // calculated for V, set V's event to split and set the appropriate fields
  if (minL < event.L) {
    event.type = SSEventTypes.splitEvent | splitType;
    event.L = minL;
    event.intersection = splitPoint;
    event.otherNode = eventNode;
  }
}

// given a set of LAVs, compute the initial events
StraightSkeleton.prototype.calculateInitialEvents = function(slav) {
  var pq = this.pq;

  for (var lav of slav) {
    var lnode = lav;
    do {
      var event = new SSEvent(lnode);

      this.calculateEdgeEvent(event);
      this.calculateSplitEventSLAV(event, slav);

      this.queueEvent(event);

      lnode = lnode.next;
    } while (lnode != lav);
  }
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
