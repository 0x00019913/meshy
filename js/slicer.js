/* slicer.js */
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

  // 1. assume right-handed coords
  // 2. look along negative this.axis with the other axes pointing up and right
  // then this.axis1 points right and this.axis2 points up
  this.axis1 = this.axis=="x" ? "y" : this.axis=="y" ? "z" : "x";
  this.axis2 = this.axis=="x" ? "z" : this.axis=="y" ? "x" : "y";

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
    vertices: this.pathVertices
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

  var loopBuilder = new EdgeLoopBuilder(axis);

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

      loopBuilder.addSegment(AB, AC, newFace.normal);
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

      loopBuilder.addSegment(AC, BC, newFace2.normal);
    }
  }

  // put the new verts and faces on the end of the existing array
  this.previewVertices = vertices.concat(newVertices);
  this.previewFaces = faces.concat(newFaces);

  // erase whatever we allocated and didn't need
  this.previewVertices.length = vertexCount + vidx;
  this.previewFaces.length = faceCount + fidx;

  var edgeLoops = loopBuilder.makeEdgeLoops();
  console.log(edgeLoops);
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

// circular double-linked list symbolizing an edge loop
EdgeLoop = function(vertices, axis) {
  this.axis = axis;
  this.axis1 = this.axis=="x" ? "y" : this.axis=="y" ? "z" : "x";
  this.axis2 = this.axis=="x" ? "z" : this.axis=="y" ? "x" : "y";

  this.count = 0;
  this.area = 0;
  this.hole = false;
  this.vertex = null;

  // bounds - used for bounding-box tests and for
  this.min1 = Infinity;
  this.max1 = -Infinity;
  this.min2 = Infinity;
  this.max2 = -Infinity;

  this.polysInside = new Set();
  this.polysOutside = new Set();
  this.holesInside = new Set();
  this.holesOutside = new Set();

  if (!vertices || vertices.length < 1) return;

  var start = null;

  for (var i = 0; i < vertices.length; i++) {
    var v = vertices[i];

    // update bounds
    this.min1 = Math.min(this.min1, v[this.axis1]);
    this.max1 = Math.max(this.max1, v[this.axis1]);
    this.min2 = Math.min(this.min2, v[this.axis2]);
    this.max2 = Math.max(this.max2, v[this.axis2]);

    // create the node for this vertex
    var node = {
      v: v,
      prev: null,
      next: null
    }

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

  if (this.area < 0) this.hole = true;
}

EdgeLoop.prototype.contains = function(other) {
  if (this.max1 < other.min1 || this.min1 > other.max1) return false;
  if (this.max2 < other.min2 || this.min2 > other.max2) return false;

  // todo: point-in-polygon testing

  return true;
}

EdgeLoopBuilder = function(axis) {
  this.p = Math.pow(10, 7);
  this.axis = axis;
  this.up = new THREE.Vector3();
  this.up[axis] = 1;

  this.adjacencyMap = {};
}

EdgeLoopBuilder.prototype.clear = function() {
  this.adjacencyMap = {};
}

EdgeLoopBuilder.prototype.addSegment = function(v1, v2, normal) {
  this.insertNeighbor(v1, v2, normal);
  this.insertNeighbor(v2, v1, normal);
}

EdgeLoopBuilder.prototype.insertNeighbor = function(v1, v2, n) {
  var v1hash = vertexHash(v1, this.p);
  var a = this.adjacencyMap;

  if (!a.hasOwnProperty(v1hash)) a[v1hash] = {
    v : v1,
    neighbors: [],
    normals: [],
    visited: false
  };

  a[v1hash].neighbors.push(v2);
  a[v1hash].normals.push(n);
}

EdgeLoopBuilder.prototype.makeEdgeLoops = function() {
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

    var neighbors, normals;

    current = start;

    // go along the loop till it closes
    do {
      if (!a.hasOwnProperty(current)) break;

      vertices.push(a[current].v);

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

    var edgeLoop = new EdgeLoop(vertices, axis);

    if (edgeLoop.hole) loops.holes.push(edgeLoop);
    else loops.polys.push(edgeLoop);
  }

  this.calculateHierarchy(loops);

  return loops;
}

EdgeLoopBuilder.prototype.calculateHierarchy = function(loops) {
  var polys = loops.polys;
  var holes = loops.holes;

  // tests whether poly i contains poly j
  for (var i=0; i<polys.length; i++) {
    for (var j=0; j<polys.length; j++) {
      if (i==j) continue;

      var ipoly = polys[i];
      var jpoly = polys[j];
      // if j contains i, then i does not contain j
      if (jpoly.polysInside.has(i)) {
        ipoly.polysOutside.add(j);
        // if j contains i, then i does not contain polys j does not contain
        ipoly.polysOutside = new Set([...ipoly.polysOutside, ...jpoly.polysOutside]);
        continue;
      }

      if (ipoly.contains(jpoly)) {
        ipoly.polysInside.add(j);
        // if i contains j, i also contains polys j contains
        ipoly.polysInside = new Set([...ipoly.polysInside, ...jpoly.polysInside]);
      }
      else {
        ipoly.polysOutside.add(j);
        // if i does not contain j, i does not contain anything j contains
        ipoly.polysOutside = new Set([...ipoly.polysOutside, ...jpoly.polysInside]);
      }
    }
  }

  // test whether poly i contains hole j
  for (var i=0; i<polys.length; i++) {
    for (var j=0; j<holes.length; j++) {
      var ipoly = polys[i];
      var jhole = holes[j];

      if (ipoly.contains(jhole)) ipoly.holesInside.add(j);
      else ipoly.holesOutside.add(j);
    }
  }

  return;

  // back up the initial hole containment data so we can reference it while we
  // mutate the actual data
  var sourceHolesInside = new Array(polys.length);
  for (var i=0; i<polys.length; i++) {
    sourceHolesInside[i] = new Set(polys[i].holesInside);
    console.log(sourceHolesInside, polys[i].holesInside);
  }

  // if poly i contains poly j, eliminate holes contained by j from i's list
  for (var i=0; i<polys.length; i++) {
    for (var j=0; j<polys.length; j++) {
      if (i==j) continue;

      var ipoly = polys[i];
      var jpoly = polys[j];

      if (ipoly.polysInside.has(j)) {
        var iholes = ipoly.holesInside;
        var sjholes = sourceHolesInside[j];
        console.log(i, j, iholes, sjholes);

        // for every hole in j, if i contains it, delete it from i's holes so
        // that every poly only has the holes which it immediately contains
        for (var jh of sjholes) iholes.delete(jh);
        console.log(i, j, iholes);
      }
    }
  }
}
