/* slicer.js */

function Slicer(sourceVertices, sourceFaces, params) {
  this.sourceVertices = sourceVertices;
  this.sourceFaces = sourceFaces;
  this.sourceVertexCount = sourceVertices.length;
  this.sourceFaceCount = sourceFaces.length;

  this.previewVertices = null;
  this.previewFaces = null;

  this.layerVertices = null;

  this.layers = null;

  this.mode = "preview";
  this.axis = "z";
  this.sliceHeight = 0.5;
  this.lineWidth = this.sliceHeight;
  this.numWalls = 2;

  // set from params
  if (params) {
    if (params.hasOwnProperty("mode")) this.mode = params.mode;
    if (params.hasOwnProperty("axis")) this.axis = params.axis;
    if (params.hasOwnProperty("sliceHeight")) this.sliceHeight = params.sliceHeight;
    if (params.hasOwnProperty("lineWidth")) this.lineWidth = params.lineWidth;
    if (params.hasOwnProperty("numWalls")) this.numWalls = params.numWalls;
  }

  this.previewGeometryReady = false;
  this.layerGeometryReady = false;

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
    var bounds = faceGetBoundsAxis(face, this.sourceVertices, this.axis);

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

  if (mode=="preview") this.makePreviewGeometry();
  else if (this.mode=="layer") this.makeLayerGeometry();

  this.setSlice(this.currentSlice);
}

Slicer.prototype.getMode = function() {
  return this.mode;
}

Slicer.prototype.readyPreviewGeometry = function() {
  this.previewGeometryReady = true;
}
Slicer.prototype.readyLayerGeometry = function() {
  this.layerGeometryReady = true;
}
Slicer.prototype.unreadyPreviewGeometry = function() {
  this.previewGeometryReady = false;
}
Slicer.prototype.unreadyLayerGeometry = function() {
  this.layerGeometryReady = false;
}
Slicer.prototype.setLineWidth = function(lineWidth) {
  this.lineWidth = lineWidth;
}
Slicer.prototype.setNumWalls = function(numWalls) {
  this.numWalls = numWalls;
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
    if (bounds.min >= sliceLevel) bounds.face.materialIndex = 1;
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

  // current vertex
  var vidx = vertexCount;

  var layerBuilder = new LayerBuilder(axis);
  var segmentSet = new SegmentSet(axis, 1e-7);

  // slice the faces
  for (var f = 0; f < slicedFaces.length; f++) {
    var slicedFace = slicedFaces[f];

    // in the following, A is the bottom vert, B is the middle vert, and XY
    // are the points there the triangle intersects the X-Y segment

    // get verts sorted on axis; check if this flipped winding order (default is CCW)
    var vertsSorted = faceGetVertsSorted(slicedFace, vertices, axis);
    var [A, B, C] = vertsSorted.verts;
    var ccw = vertsSorted.ccw;

    /*var aA = A[axis];
    var aB = B[axis];
    var aC = C[axis];

    if (aA === aC) continue;
    if (aA === sliceLevel && aA < aB) continue;
    if (aC === sliceLevel && aB < aC) continue;

    if (new THREE.Vector3(2.1, 2.1, A.z).sub(A).length() < 1.6) {
      console.log(A, B, C, sliceLevel);
      debug.line(A, B);
      debug.line(B, C);
      debug.line(C, A);
    }*/

    // if middle vert is greater than slice level, slice into 1 triangle A-AB-AC
    if (B[axis] > sliceLevel) {
      // calculate intersection of A-B and A-C
      var AB = segmentPlaneIntersection(axis, sliceLevel, A, B);
      var AC = segmentPlaneIntersection(axis, sliceLevel, A, C);

      // get indices of these verts in the final vert array before pushing them there
      var idxA = vidx;
      var idxAB = idxA + 1;
      var idxAC = idxA + 2;
      vertices.push(A);
      vertices.push(AB);
      vertices.push(AC);
      vidx += 3;

      // create the new face and push it into the faces array
      var newFace;
      if (ccw) {
        newFace = new THREE.Face3(idxA, idxAB, idxAC);
      }
      else {
        newFace = new THREE.Face3(idxA, idxAC, idxAB);
      }
      newFace.normal.copy(slicedFace.normal);

      // explicitly visible
      newFace.materialIndex = 0;

      faces.push(newFace);

      layerBuilder.addSegment(AB, AC, newFace.normal);
      segmentSet.addSegment(AB, AC, newFace.normal);
    }
    // else, slice into two triangles: A-B-AC and B-BC-AC
    else {
      // calculate intersection of A-C and B-C
      var AC = segmentPlaneIntersection(axis, sliceLevel, A, C);
      var BC = segmentPlaneIntersection(axis, sliceLevel, B, C);
      // get indices of these verts in the vert array before pushing them there
      var idxA = vidx;
      var idxB = idxA + 1;
      var idxAC = idxA + 2;
      var idxBC = idxA + 3;
      vertices.push(A);
      vertices.push(B);
      vertices.push(AC);
      vertices.push(BC);
      vidx += 4;

      // create the new faces and push it into the faces array
      var newFace1, newFace2;
      if (ccw) {
        newFace1 = new THREE.Face3(idxA, idxB, idxAC);
        newFace2 = new THREE.Face3(idxB, idxBC, idxAC);
      }
      else {
        newFace1 = new THREE.Face3(idxA, idxAC, idxB);
        newFace2 = new THREE.Face3(idxB, idxAC, idxBC);
      }
      newFace1.normal.copy(slicedFace.normal);
      newFace2.normal.copy(slicedFace.normal);

      // explicitly visible
      newFace1.materialIndex = 0;
      newFace2.materialIndex = 0;

      faces.push(newFace1);
      faces.push(newFace2);

      layerBuilder.addSegment(AC, BC, newFace2.normal);
      segmentSet.addSegment(AC, BC, newFace2.normal);
    }
  }

  //var layer = layerBuilder.getLayer();
  //layer.triangulate(vertices, faces);

  debug.cleanup();
  segmentSet.unify();
}

Slicer.prototype.setLayerSlice = function() {
  var slice = this.currentSlice;
  // todo
}

Slicer.prototype.makePreviewGeometry = function() {
  if (this.previewGeometryReady) return;

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
  if (this.layerGeometryReady) return;

  // construct the layers array, which contains the structures necessary for
  // computing the actual geometry
  if (!this.layers) this.computeLayers();

  var layers = this.layers;
  var layerVertices = [];

  for (var l=0; l<layers.length; l++) {
    var layer = layers[l];
    //console.log(l, layers.length);
    layer.computeContours(this.lineWidth, this.numWalls);
    layer.writeContoursToVerts(layerVertices);
  }

  this.layerGeometryReady = true;
  this.layerVertices = layerVertices;
}

Slicer.prototype.computeLayers = function() {
  var layers = [];

  // arrays of segments, each array signifying all segments in one layer
  var segmentLists = this.buildLayerSegmentLists();

  var layerBuilder = new LayerBuilder(this.axis);

  for (var i=0; i<segmentLists.length; i++) {
    var segmentList = segmentLists[i];
    for (var s=0; s<segmentList.length; s++) {
      var segment = segmentList[s];

      layerBuilder.addSegment(segment[0], segment[1], segment[2]);
    }

    if (false && i!=2) {
      layerBuilder.clear();
      continue;
    }

    var layer = layerBuilder.getLayer();
    layerBuilder.clear();

    layers.push(layer);
  }

  this.layers = layers;
}



// SLICING THE MESH INTO PATHS

// uses an implementation of "An Optimal Algorithm for 3D Triangle Mesh Slicing"
// http://www.dainf.ct.utfpr.edu.br/~murilo/public/CAD-slicing.pdf

// build arrays of faces crossing each slicing plane
Slicer.prototype.buildLayerFaceLists = function() {
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

// build arrays of segments in each slicing plane
Slicer.prototype.buildLayerSegmentLists = function() {
  var layerLists = this.buildLayerFaceLists();

  // various local vars
  var numLayers = layerLists.length;
  var faceBounds = this.faceBounds;
  var min = this.min;
  var axis = this.axis;
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
        if (a0 === a2) continue;
        if (a0 === sliceLevel && a0 < a1) continue;
        if (a2 === sliceLevel && a1 < a2) continue;

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
function Layer(polys) {
  // the original polygons made from the surface of the mesh
  this.basePolygons = polys;
  // arrays of vertices forming the printable contours of the mesh
  this.contours = null;
  // polygons delineating the boundary of infill
  this.innerPolygons = null;
  // straight skeleton for every base polygon; potentially replace this with an
  // array of offsetters which will have different options for offsetting
  this.skeletons = null;
  // arrays of vertices forming the infill
  this.infill = null;
}

// triangulate every polygon in the layer
Layer.prototype.triangulate = function(vertices, faces) {
  // polys is an array of edgeloops signifying every polygon in the slice
  var polys = this.basePolygons;

  for (var p = 0; p < polys.length; p++) {
    var poly = polys[p];

    // nfirst merge polygon's holes so that we don't triangulate over them
    poly.mergeHolesIntoPoly();
    // get vertices
    var pvertices = poly.getVertexArray();
    // get triangulation indices; this destroys the polygon
    var pindices  = poly.triangulate();

    var offset = vertices.length;

    // append poly vertices
    arrayAppend(vertices, pvertices);

    // make new faces and append them to the faces array
    for (var i = 0; i < pindices.length; i += 3) {
      var face = new THREE.Face3(
        pindices[i] + offset,
        pindices[i+1] + offset,
        pindices[i+2] + offset
      );
      faceComputeNormal(face, vertices);
      face.materialIndex = 2;

      faces.push(face);
    }
  }
}

Layer.prototype.makeSkeletons = function() {
  var skeletons = [];

  var polys = this.basePolygons;

  for (var i=0; i<polys.length; i++) {
    //if (i!=1) continue;
    skeletons.push(new StraightSkeleton(polys[i]));
  }

  this.skeletons = skeletons;
}

Layer.prototype.computeContours = function(lineWidth, numWalls) {
  if (!this.skeletons) this.makeSkeletons();

  var skeletons = this.skeletons;
  var contours = [];

  for (var i=0; i<skeletons.length; i++) {
    var skeleton = skeletons[i];
    for (var w=0; w<numWalls; w++) {
      var offset = (w + 0.5) * lineWidth;
      contours = contours.concat(skeleton.generateOffsetCurve(offset));
    }
  }

  this.contours = contours;
}

Layer.prototype.writeContoursToVerts = function(vertices) {
  if (!this.contours) return;

  var contours = this.contours;

  for (var c=0; c<contours.length; c++) {
    var contour = contours[c];

    for (var i=0; i<contour.length-1; i++) {
      vertices.push(contour[i]);
      vertices.push(contour[i+1]);
    }
    // to avoid n mod computations
    vertices.push(contour[contour.length-1]);
    vertices.push(contour[0]);
  }
}

// add pairs of verts with .addSegment, then get the layer with .getLayer
// and .clear if reusing
function LayerBuilder(axis) {
  this.p = 1e9;
  this.axis = axis;
  this.ah = cycleAxis(this.axis);
  this.av = cycleAxis(this.ah);
  this.up = makeAxisUnitVector(axis);

  this.adjacencyMap = {};
}

LayerBuilder.prototype.clear = function() {
  this.adjacencyMap = {};
}

LayerBuilder.prototype.addSegment = function(v1, v2, normal) {
  this.insertNeighbor(v1, v2, normal);
  this.insertNeighbor(v2, v1, normal);
}

LayerBuilder.prototype.insertNeighbor = function(v1, v2, n) {
  var v1hash = vertexHash(v1, this.p);

  var a = this.adjacencyMap;

  if (!a.hasOwnProperty(v1hash)) a[v1hash] = this.makeAdjMapNode(v1);

  var v2hash = vertexHash(v2, this.p);
  if (v1hash == v2hash) return;

  a[v1hash].neighbors.push(v2);
  a[v1hash].normals.push(n);
}

LayerBuilder.prototype.makeAdjMapNode = function(v1) {
  var node = {
    v : v1,
    neighbors: [],
    normals: []
  };

  return node;
}

LayerBuilder.prototype.makePolys = function() {
  var a = this.adjacencyMap;
  var up = this.up;
  var axis = this.axis;
  var p = this.p;

  var polys = {
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

    var poly = new Polygon(axis, vertices);

    if (!poly.valid) continue;

    if (poly.hole) polys.holes.push(poly);
    else polys.polys.push(poly);
  }

  // assign holes to the polys containing them
  this.calculateHierarchy(polys);

  console.log(polys);

  return polys.polys;
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
