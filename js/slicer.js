/* slicer.js */

var SlicerModes = {
  preview: 1,
  layer: 2
}

function Slicer(sourceVertices, sourceFaces, params) {
  this.sourceVertices = sourceVertices;
  this.sourceFaces = sourceFaces;
  this.sourceVertexCount = sourceVertices.length;
  this.sourceFaceCount = sourceFaces.length;

  this.previewVertices = null;
  this.previewFaces = null;

  this.layerVertices = null;

  this.layers = null;

  this.mode = SlicerModes.preview;
  this.axis = "z";
  this.sliceHeight = 0.5;
  this.lineWidth = this.sliceHeight;
  this.numWalls = 2;

  this.precision = 5;

  // set from params
  if (params) {
    if (params.hasOwnProperty("mode")) this.mode = params.mode;
    if (params.hasOwnProperty("axis")) this.axis = params.axis;
    if (params.hasOwnProperty("sliceHeight")) this.sliceHeight = params.sliceHeight;
    if (params.hasOwnProperty("lineWidth")) this.lineWidth = params.lineWidth;
    if (params.hasOwnProperty("numWalls")) this.numWalls = params.numWalls;
    if (params.hasOwnProperty("precision")) this.precision = params.precision;
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

  if (mode==SlicerModes.preview) this.makePreviewGeometry();
  else if (this.mode==SlicerModes.layer) this.makeLayerGeometry();

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
  if (this.mode==SlicerModes.preview) return {
    vertices: this.previewVertices,
    faces: this.previewFaces
  };
  else if (this.mode==SlicerModes.layer) return {
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
  if (this.mode==SlicerModes.preview) this.setPreviewSlice();
  else if (this.mode==SlicerModes.layer) this.setLayerSlice();
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

  //var layerBuilder = new LayerBuilder(axis);
  var context = new MCG.Context(axis, sliceLevel, this.precision);
  var segmentSet = new MCG.SegmentSet(context);

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

      //layerBuilder.addSegment(AB, AC, newFace.normal);
      var segment = new MCG.Segment(context).fromVector3Pair(AB, AC, newFace.normal);
      segmentSet.add(segment);
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

      //layerBuilder.addSegment(AC, BC, newFace2.normal);
      var segment = new MCG.Segment(context).fromVector3Pair(AC, BC, newFace2.normal);
      segmentSet.add(segment);
    }
  }

  //var layer = layerBuilder.getLayer();
  //layer.triangulate(vertices, faces);
  debug.cleanup();
  if (segmentSet.count() > 0) {
    var polygonSet = segmentSet.toPolygonSet();
    polygonSet.forEachPointPair(function(p1, p2) {
      return;
      var v1 = p1.toVector3();
      var v2 = p2.toVector3();
      debug.line(v1, v2);
    });
    debug.lines();
    var result = MCG.Boolean.union(polygonSet, undefined, false).toPolygonSet();
    if (result.count() < 1 || !result.elements[0].valid()) console.log(result, "NO RESULT GEOMETRY");
    result.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3();
      var v2 = p2.toVector3();
      debug.line(v1, v2, 1, false, 0.1, axis);
    });

    for (var io = -20; io < 20; io++) {
      break;
      if (io != 12) continue;
      var offset = result.offset(io * 0.25);
      var uoffset = MCG.Boolean.union(offset, undefined);
      var upoffset = uoffset.toPolygonSet();
      upoffset.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3();
        var v2 = p2.toVector3();
        debug.line(v1, v2, 1, false, 0.1, axis);
      });
    }
    debug.lines();
  }
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
  if (!this.layers) this.makeLayers();

  var layers = this.layers;
  var layerVertices = [];

  for (var l=0; l<layers.length; l++) {
    if (l!=1) continue;
    var layer = layers[l];

    layer.computeContours(this.lineWidth, this.numWalls);
    layer.writeToVerts(layerVertices);
  }
  debug.lines();

  this.layerVertices = layerVertices;
  this.layerGeometryReady = true;
}

Slicer.prototype.makeLayers = function() {
  var layers = [];

  // arrays of segments, each array signifying all segments in one layer
  var segmentSets = this.buildLayerSegmentSets();

  for (var i=0; i<segmentSets.length; i++) {
    // unify base contours
    var segmentSet = MCG.Boolean.union(segmentSets[i]);

    // create layer from the contours
    var layer = new Layer(segmentSet);
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

// build segment sets in each slicing plane
Slicer.prototype.buildLayerSegmentSets = function() {
  var layerLists = this.buildLayerFaceLists();

  // various local vars
  var numLayers = layerLists.length;
  var faceBounds = this.faceBounds;
  var min = this.min;
  var axis = this.axis;
  var sliceHeight = this.sliceHeight;
  var vertices = this.sourceVertices;
  var faces = this.sourceFaces;

  var segmentSets = new Array(numLayers);

  // running set of active face indices as we sweep up along the layers
  var sweepSet = new Set();

  for (var i=0; i<numLayers; i++) {
    // height of layer from mesh min
    var sliceLevel = min + (i + 0.5) * sliceHeight;

    // reaching a new layer, insert whatever new active face indices for that layer
    if (layerLists[i].length>0) sweepSet = new Set([...sweepSet, ...layerLists[i]]);

    var context = new MCG.Context(axis, sliceLevel, this.precision);

    // accumulate segments for this layer
    var segmentSet = new MCG.SegmentSet(context);

    // for each index in the sweep list, see if it intersects the slicing plane:
    //  if it's below the slicing plane, eliminate it
    //  else, store its intersection with the slicing plane
    for (var idx of sweepSet) {
      var bounds = faceBounds[idx];

      if (bounds.max < sliceLevel) sweepSet.delete(idx);
      else {
        // get verts sorted in ascending order on axis; call it [A,B,C]
        var [A, B, C] = faceGetVertsSorted(bounds.face, vertices, axis).verts;
        var aA = A[axis];
        var aB = B[axis];
        var aC = C[axis];

        // face is flat or intersects slicing plane at a point
        if (aA === aC) continue;
        if (aA === sliceLevel && aA < aB) continue;
        if (aC === sliceLevel && aB < aC) continue;

        // if B is above slicing plane, calculate AB and AC intersection
        var int1;
        if (aB > sliceLevel) {
          int1 = segmentPlaneIntersection(axis, sliceLevel, A, B);
        }
        // else, calculate BC and AC intersection
        else {
          int1 = segmentPlaneIntersection(axis, sliceLevel, B, C);
        }
        var int2 = segmentPlaneIntersection(axis, sliceLevel, A, C);

        var segment = new MCG.Segment(context);
        segment.fromVector3Pair(int1, int2, bounds.face.normal);
        segmentSet.add(segment);
      }
    }

    segmentSets[i] = segmentSet;
  }

  return segmentSets;
}



// contains a single slice of the mesh
function Layer(segmentSet) {
  // base polygon set; use this to generate offsets
  this.base = segmentSet.toPolygonSet();

  // internal contours
  this.contours = [];

  // set of open polygons containing the mesh infill
  this.infill = [];
}

Layer.prototype.computeContours = function(lineWidth, numWalls) {
  // todo: remove
  lineWidth = 4;
  numWalls = 0;
  debug.cleanup();

  var base = this.base;

  var contours = [];

  for (var w = 0; w < numWalls; w++) {
    var offsetSegments = MCG.Boolean.union(base.offset((w + 0.5) * -lineWidth));
    contours.push(offsetSegments.toPolygonSet());
  }

  this.contours = contours;
}

Layer.prototype.writeToVerts = function(vertices) {
  if (!this.contours) return;
  for (var c = 0; c < this.contours.length; c++) {
    this.contours[c].forEachPointPair(function(p1, p2) {
      vertices.push(p1.toVector3());
      vertices.push(p2.toVector3());
    });
  }

  this.base.computeBisectors();
  this.base.forEachPointPair(function(p1, p2) {
    vertices.push(p1.toVector3());
    vertices.push(p2.toVector3());
  });

  this.base.forEachPoint(function(p, b) {
    var pv = p.toVector3();
    var pbv = p.clone().addScaledVector(b, 0.25).toVector3();
    debug.line(pv, pbv);
  });

  /*for (var i=0; i<15; i++) {
    break;
    if (i!=13) continue;
    var off = this.base.offset(i * -0.25);
    var po = MCG.Boolean.union(off, undefined, true);
    po.forEachPointPair(function(p1, p2) {
      vertices.push(p1.toVector3());
      vertices.push(p2.toVector3());
    });
  }*/
  /*var contours = this.contours;

  for (var c=0; c<contours.length; c++) {
    var contour = contours[c];

    for (var i=0; i<contour.length-1; i++) {
      vertices.push(contour[i]);
      vertices.push(contour[i+1]);
    }
    // to avoid n mod computations
    vertices.push(contour[contour.length-1]);
    vertices.push(contour[0]);
  }*/
}
