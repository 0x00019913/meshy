/* slicer.js */

function Slicer(sourceVertices, sourceFaces, params) {
  this.sourceVertices = sourceVertices;
  this.sourceFaces = sourceFaces;
  this.sourceVertexCount = sourceVertices.length;
  this.sourceFaceCount = sourceFaces.length;

  this.previewVertices = null;
  this.previewFaces = null;
  this.previewLayerVerticesBase = null;
  this.previewLayerVertices = null;

  this.pathVerticesBase = null;
  this.pathVertices = null;

  this.setParams(params);

  this.previewGeometryReady = false;
  this.pathGeometryReady = false;

  // 1. assume right-handed coords
  // 2. look along negative this.axis with the other axes pointing up and right
  // then this.ah points right and this.av points up
  this.ah = cycleAxis(this.axis);
  this.av = cycleAxis(this.ah);

  this.calculateFaceBounds();

  // first slice is half a slice height above mesh min and last slice is
  // strictly above mesh, hence +1
  var amax = this.max[this.axis], amin = this.min[this.axis];
  this.numSlices = Math.floor(0.5 + (amax - amin) / this.sliceHeight) + 1;

  this.numLayers = this.numSlices + this.numRaftLayers;
  this.currentLevel = this.numLayers - 1;

  // construct the layers array, which contains the structures necessary for
  // computing the actual geometry
  this.makeLayers();

  this.setMode(this.mode);
}

Slicer.Modes = {
  preview: 1,
  path: 2
};

Slicer.InfillTypes = {
  none: 0,
  solid: 1,
  grid: 2,
  triangle: 4,
  hex: 8,
  // mask for all infill types that consist of lines that don't need to be
  // connected to each other
  disconnectedLineType: 1 | 2 | 4
};

Slicer.DefaultParams = {
  mode: Slicer.Modes.preview,
  axis: "z",
  sliceHeight: 0.5,
  resolution: 0.5,
  numWalls: 2,
  infillType: Slicer.InfillTypes.none,
  infillDensity: 0.1,

  makeRaft: true,
  raftMainLayers: 3,
  raftBaseLayers: 1,
  raftOffset: 1.0,
  raftGap: 0.05,
  raftBaseSpacing: 0.1,

  precision: 5
};

Slicer.prototype.setParams = function(params) {
  params = params || {};

  for (var p in Slicer.DefaultParams) {
    if (params.hasOwnProperty(p)) {
      this[p] = params[p];
    }
    else {
      this[p] = Slicer.DefaultParams[p];
    }
  }

  this.numRaftLayers = this.makeRaft ? this.raftBaseLayers + this.raftMainLayers : 0;
  if (this.infillDensity === 0) this.infillType = Slicer.InfillTypes.none;
}

// necessary function - called from constructor
// calculates min and max for every face on the axis
Slicer.prototype.calculateFaceBounds = function() {
  var faceBounds = [];
  var axis = this.axis;
  var min = new THREE.Vector3().setScalar(Infinity);
  var max = new THREE.Vector3().setScalar(-Infinity);

  for (var i=0; i<this.sourceFaces.length; i++) {
    var face = this.sourceFaces[i];
    var bounds = faceGetBounds(face, this.sourceVertices);

    max.max(bounds.max);
    min.min(bounds.min);

    // store min and max for each face
    faceBounds.push({
      face: face.clone(),
      max: bounds.max[axis],
      min: bounds.min[axis]
    });
  }

  this.min = min;
  this.max = max;

  this.faceBounds = faceBounds;
}

Slicer.prototype.setMode = function(mode) {
  this.mode = mode;

  if (mode==Slicer.Modes.preview) this.makePreviewGeometry();
  else if (this.mode==Slicer.Modes.path) this.makePathGeometry();

  this.setLevel(this.currentLevel);
}

Slicer.prototype.getMode = function() {
  return this.mode;
}

Slicer.prototype.readyPreviewGeometry = function() {
  this.previewGeometryReady = true;
}
Slicer.prototype.readyPathGeometry = function() {
  this.pathGeometryReady = true;
}
Slicer.prototype.unreadyPreviewGeometry = function() {
  this.previewGeometryReady = false;
}
Slicer.prototype.unreadyPathGeometry = function() {
  this.pathGeometryReady = false;
}
Slicer.prototype.setResolution = function(resolution) {
  this.resolution = resolution;
}
Slicer.prototype.setNumWalls = function(numWalls) {
  this.numWalls = numWalls;
}

Slicer.prototype.getGeometry = function() {
  if (this.mode==Slicer.Modes.preview) return {
    vertices: this.previewVertices,
    faces: null
  };
  else if (this.mode==Slicer.Modes.path) return {
    vertices: this.pathVertices,
    faces: null
  };
}

Slicer.prototype.getNumLayers = function() {
  return this.numLayers;
}

Slicer.prototype.getCurrentLevel = function() {
  return this.currentLevel;
}

Slicer.prototype.setLevel = function(level) {
  level = clamp(level, 0, this.numLayers - 1);
  this.currentLevel = level;

  if (this.mode==Slicer.Modes.preview) this.setPreviewLayer();
  else if (this.mode==Slicer.Modes.Path) this.setPathLayer();
}

Slicer.prototype.setPreviewLayer = function() {
  var level = this.currentLevel;

  var sliceLevel = this.min[this.axis] + (level-0.5) * this.sliceHeight;
  var faceBounds = this.faceBounds;

  /*
  // array of faces that intersect the slicing plane
  var slicedFaces = [];

  if (!this.gpu) this.gpu = new GPU();
  var compute = this.gpu.createKernel(function(a) {
    return a[this.thread.x];
  }).setOutput([faceBounds.length]);

  var c = compute(faceBounds);

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

  // slice the faces
  for (var f = 0; f < slicedFaces.length; f++) {
    var slicedFace = slicedFaces[f];

    this.sliceFace(slicedFace, vertices, sliceLevel, axis, function(normal, ccw, A, B, C, D) {
      if (D === undefined) {
        var idxA = vidx;
        var idxB = idxA + 1;
        var idxC = idxA + 2;
        vertices.push(A);
        vertices.push(B);
        vertices.push(C);
        vidx += 3;

        var newFace;
        if (ccw) newFace = new THREE.Face3(idxA, idxB, idxC);
        else newFace = new THREE.Face3(idxB, idxA, idxC);

        newFace.normal.copy(slicedFace.normal);

        // explicitly visible
        newFace.materialIndex = 0;

        faces.push(newFace);
      }
      else {
        var idxA = vidx;
        var idxB = idxA + 1;
        var idxC = idxA + 2;
        var idxD = idxA + 3;
        vertices.push(A);
        vertices.push(B);
        vertices.push(C);
        vertices.push(D);
        vidx += 4;

        // create the new faces and push it into the faces array
        var newFace1, newFace2;
        if (ccw) {
          newFace1 = new THREE.Face3(idxA, idxB, idxC);
          newFace2 = new THREE.Face3(idxC, idxB, idxD);
        }
        else {
          newFace1 = new THREE.Face3(idxB, idxA, idxC);
          newFace2 = new THREE.Face3(idxB, idxC, idxD);
        }
        newFace1.normal.copy(slicedFace.normal);
        newFace2.normal.copy(slicedFace.normal);

        // explicitly visible
        newFace1.materialIndex = 0;
        newFace2.materialIndex = 0;

        faces.push(newFace1);
        faces.push(newFace2);
      }
    });
  }*/

  debug.cleanup();

  var layer = this.layers[level];
  var context = layer.context;
  var axis = context.axis;
  var vertices = [];

  if (level >= this.numRaftLayers) {
    layer.computePrintContours(this.resolution, this.numWalls);

    if (0) {
      layer.base.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 0.0, axis);
      });

      if (layer.printContours.length>1) {
        layer.printContours[0].forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 1.0, axis);
        });
        layer.base.foffset(-0.025, this.resolution).forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 1.2, axis);
        });
        layer.printContours[1].forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 2.0, axis);
        });
        layer.printContours[0].foffset(-0.05, this.resolution).forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 2.2, axis);
        });
        var o = layer.printContours[1].foffset(-0.025, this.resolution, true);
        o.forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 3.0, axis);
        });

        var u = MCG.Boolean.union(o, undefined, false).union;

        u.forEachPointPair(function(p1, p2) {
          var v1 = p1.toVector3(THREE.Vector3, context);
          var v2 = p2.toVector3(THREE.Vector3, context);
          debug.line(v1, v2, 1, false, 4.0, axis);
        });

      }


      debug.lines();
      return;
    }

    var contours = layer.printContours;

    for (var w = 0; w < contours.length; w++) {
      contours[w].forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 0.0, axis);
      });
    }

    layer.computeInfill(this.resolution, this.numWalls, this.infillType, this.infillDensity);
  }
  else {
    layer.base.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 0.0, axis);
    });

  }


  if (0) {

    // 3: 3 infill contours

    var below = layer.getBelow();
    var above = layer.getAbove();
    if (below) {
      below.infillContour.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 3.0, axis);
      });
    }
    layer.infillContour.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 3.2, axis);
    });
    if (above) {
      above.infillContour.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 3.4, axis);
      });
    }

    // recalculated infill contour
    if (1) {
      var b = layer.printContours[layer.printContours.length-1];
      var o = b.foffset(-this.resolution/2, this.resolution);

      o.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 3.6, axis);
      });

      var u = MCG.Boolean.union(o, undefined, true).union;
      u.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 3.8, axis);
      });
      debug.point(new MCG.Vector(u.context, -2820128, 450000).toVector3(), 3.9, u.context.axis);
      debug.point(new MCG.Vector(u.context, -2820128, 500000).toVector3(), 3.9, u.context.axis);
    }

    // 5: 2 differences

    layer.layerDifferences.AminusB.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 5.0, axis);
    });

    if (above) {
      above.layerDifferences.BminusA.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 5.2, axis);
      });
    }

    // 7: 2 intersections

    layer.layerDifferences.intersection.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 7.0, axis);
    });

    if (above) {
      above.layerDifferences.intersection.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 7.2, axis);
      });
    }

    // 7: recalculated intersection of intersections

    if (0 && above) {
      var int = MCG.Boolean.intersection(
        above.layerDifferences.intersection, layer.layerDifferences.intersection, true
      ).intersection;

      var adj = int.makeAdjacencyMap();
      console.log(adj.getKeyWithNoPredecessors());
      debug.point(new MCG.Vector(int.context, -2820128, 523229).toVector3(), 7.025, context.axis);

      int.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 7.015, axis);
      });

      int.toPolygonSet().forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 7.02, axis);
      });
    }

    // 9: infill contours

    layer.infillDisjointContours.inner.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 9.0, axis);
    });

    layer.infillDisjointContours.solid.forEachPointPair(function(p1, p2) {
      var v1 = p1.toVector3(THREE.Vector3, context);
      var v2 = p2.toVector3(THREE.Vector3, context);
      debug.line(v1, v2, 1, false, 9.2, axis);
    });
  }

  if (layer.infill) {
    if (layer.infill.inner) {
      layer.infill.inner.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 0.0, axis);
      });
    }

    if (layer.infill.solid) {
      layer.infill.solid.forEachPointPair(function(p1, p2) {
        var v1 = p1.toVector3(THREE.Vector3, context);
        var v2 = p2.toVector3(THREE.Vector3, context);
        debug.line(v1, v2, 1, false, 0.0, axis);
      });
    }
  }

  debug.lines();

  return;
}

Slicer.prototype.setLayerSlice = function() {
  var slice = this.currentLevel;
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

Slicer.prototype.makePathGeometry = function() {
  if (this.pathGeometryReady) return;

  var layers = this.layers;
  var layerVertices = [];

  for (var l = 0; l < layers.length; l++) {
    var layer = layers[l];
    if (layer === undefined) continue;
    var above = l > 0 ? layers[l-1] : null;

    layer.computePrintContours(this.resolution, this.numWalls);
    layer.computeInfill(this.resolution, this.numWalls, this.infillType, this.infillDensity, above);

    layer.writeToVerts(layerVertices);
  }

  debug.lines();

  this.layerVertices = layerVertices;
  this.pathGeometryReady = true;
}

Slicer.prototype.makeLayers = function() {
  var layers = new Array(this.numLayers);
  var numRaftLayers = this.numRaftLayers;
  var resolution = this.resolution;

  // arrays of segments, each array signifying all segments in one layer
  var segmentSets = this.buildLayerSegmentSets();

  // make layers containing slices of the mesh
  for (var i = 0; i < segmentSets.length; i++) {
    var idx = i + numRaftLayers;

    var layer = new Layer(segmentSets[i], resolution, layers, idx);

    layers[idx] = layer;
  }

  // make the raft layers
  if (this.makeRaft) {
    var bottomLayer = layers[numRaftLayers];
    var baseOffset = bottomLayer.base.foffset(this.raftOffset);
    var base = MCG.Boolean.union(baseOffset).union.toPolygonSet();
    var min = this.min[this.axis];
    var sliceHeight = this.sliceHeight;
    var gap = this.raftGap;

    for (var i = 0; i < numRaftLayers; i++) {
      var sliceLevel = min - gap - (numRaftLayers - i - 0.5) * sliceHeight;
      var context = new MCG.Context(this.axis, sliceLevel, this.precision);

      var layer = new Layer(base.clone().setContext(context), resolution, i, null);

      layers[i] = layer;
    }
  }

  this.layers = layers;
}



// SLICING THE MESH INTO PATHS

// uses an implementation of "An Optimal Algorithm for 3D Triangle Mesh Slicing"
// http://www.dainf.ct.utfpr.edu.br/~murilo/public/CAD-slicing.pdf

// build arrays of faces crossing each slicing plane
Slicer.prototype.buildLayerFaceLists = function() {
  var sliceHeight = this.sliceHeight;
  var faceBounds = this.faceBounds;
  var min = this.min[this.axis];

  var numSlices = this.numSlices;

  // position of first and last layer
  var layer0 = min + sliceHeight / 2;
  var layerk = layer0 + sliceHeight * (numSlices);

  // init layer lists
  var layerLists = new Array(numSlices);
  for (var i = 0; i < numSlices; i++) layerLists[i] = [];

  // bucket the faces
  for (var i = 0; i < this.sourceFaceCount; i++) {
    var bounds = faceBounds[i];
    var idx;

    if (bounds.min < layer0) idx = 0;
    else if (bounds.min > layerk) idx = numSlices;
    else idx = Math.ceil((bounds.min - layer0) / sliceHeight);

    layerLists[idx].push(i);
  }

  return layerLists;
}

// build segment sets in each slicing plane
Slicer.prototype.buildLayerSegmentSets = function() {
  var layerLists = this.buildLayerFaceLists();

  // various local vars
  var numSlices = layerLists.length;
  var faceBounds = this.faceBounds;
  var axis = this.axis;
  var min = this.min[axis];
  var sliceHeight = this.sliceHeight;
  var vertices = this.sourceVertices;
  var faces = this.sourceFaces;

  var segmentSets = new Array(numSlices);

  // running set of active face indices as we sweep up along the layers
  var sweepSet = new Set();

  for (var i = 0; i < numSlices; i++) {
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
        this.sliceFace(bounds.face, vertices, sliceLevel, axis, function(normal, ccw, A, B) {
          var segment = new MCG.Segment(context);
          segment.fromVector3Pair(A, B, normal);
          segmentSet.add(segment);
        });
      }
    }

    segmentSets[i] = segmentSet;
  }

  return segmentSets;
}

// slice a face at the given level and then call the callback
// callback arguments:
//  normal: face normal
//  ccw: used for winding the resulting verts
//  A, B, C, D: A and B are the sliced verts, the others are from the original
//    geometry (if sliced into one triangle, D will be undefined);
//    if ccw, the triangles are ABC and CBD, else BAC and BCD
Slicer.prototype.sliceFace = function(face, vertices, level, axis, callback) {
  // in the following, A is the bottom vert, B is the middle vert, and XY
  // are the points there the triangle intersects the X-Y segment

  var normal = face.normal;

  // get verts sorted on axis; check if this flipped winding order (default is CCW)
  var vertsSorted = faceGetVertsSorted(face, vertices, axis);
  var [A, B, C] = vertsSorted.verts;
  var ccw = vertsSorted.ccw;

  // if middle vert is greater than slice level, slice into 1 triangle A-AB-AC
  if (B[axis] > level) {
    // calculate intersection of A-B and A-C
    var AB = segmentPlaneIntersection(axis, level, A, B);
    var AC = segmentPlaneIntersection(axis, level, A, C);

    callback(normal, ccw, AB, AC, A);
  }
  // else, slice into two triangles: A-B-AC and B-BC-AC
  else {
    // calculate intersection of A-C and B-C
    var AC = segmentPlaneIntersection(axis, level, A, C);
    var BC = segmentPlaneIntersection(axis, level, B, C);

    callback(normal, ccw, BC, AC, B, A);
  }
}



// contains a single slice of the mesh
function Layer(source, resolution, layers, idx) {
  this.source = source;

  // base contour, decimated and unified
  this.base = null;

  // store resolution and context
  this.resolution = resolution;
  this.context = source.context;

  // layer array and this layer's index in it
  this.layers = layers;
  this.idx = idx;

  // internal contours for printing
  this.printContours = null;

  // main contour containing the infill
  this.infillContour = null;

  // differences and intersections between the infill contours of this layer and
  // adjacent layers - used to compute infill
  this.layerDifferences = null;

  // if infill is not solid, some regions may be filled with that infill, but
  // some might need solid infill b/c they're exposed to air above or below:
  // inner contour can be filled with the specified infill type; solid infill
  // is filled with solid infill
  this.infillDisjointContours = null;

  // set of segments containing the mesh infill
  this.infill = null;
}

Layer.prototype.baseReady = function() { return this.base !== null; }
Layer.prototype.printContoursReady = function() { return this.printContours !== null; }
Layer.prototype.infillContourReady = function() { return this.infillContour !== null; }
Layer.prototype.layerDifferencesReady = function() { return this.layerDifferences !== null; }
Layer.prototype.infillReady = function() { return this.infill !== null; }
Layer.prototype.infillDisjointContoursReady = function() {
  return this.infillDisjointContours !== null;
}

Layer.prototype.getBelow = function() {
  var idx = this.idx;

  return idx === 0 ? null : this.layers[idx - 1];
}

Layer.prototype.getAbove = function() {
  var idx = this.idx, layers = this.layers;

  return idx === layers.length - 1 ? null : layers[idx + 1];
}

Layer.prototype.computeBase = function(force) {
  if (this.baseReady() && !force) return;

  var sourceDecimated = this.source.toPolygonSet().fdecimate(this.resolution);
  var base = MCG.Boolean.union(sourceDecimated).union.toPolygonSet();

  // source no longer necessary
  this.source = null;

  this.base = base;

  return this.base;
}

Layer.prototype.computePrintContours = function(resolution, numWalls, force) {
  if (this.printContoursReady() && !force) return;

  this.computeBase();

  var contours = [];
  var contour = this.base;

  for (var w = 0; w < numWalls; w++) {
    // inset the first contour by half resolution, all others by full resolution
    // from the preceding contour
    var dist = (w === 0 ? -0.5 : -1) * resolution;

    var offset = contour.foffset(dist, resolution);
    var union = MCG.Boolean.union(offset).union.toPolygonSet();
    contours.push(union);

    contour = union;
  }

  this.printContours = contours;

  return this.printContours;
}

Layer.prototype.computeInfillContour = function(resolution, numWalls, force) {
  if (this.infillContourReady() && !force) return;

  var source, dist;

  if (this.printContoursReady()) {
    source = this.printContours[this.printContours.length-1];
    dist = resolution / 2;
  }
  else {
    source = this.computeBase();
    dist = resolution * numWalls;
  }

  this.infillContour = MCG.Boolean.union(source.foffset(-dist, resolution)).union;

  return this.infillContour;
}

Layer.prototype.computeLayerDifferences = function(resolution, numWalls, force) {
  if (this.layerDifferencesReady() && !force) return;

  var below = this.getBelow();

  this.computeInfillContour(resolution, numWalls);
  if (below) below.computeInfillContour(resolution, numWalls);

  var contour = this.infillContour;
  var contourBelow = below !== null ? below.infillContour : new MCG.SegmentSet(this.context);

  this.layerDifferences = MCG.Boolean.fullDifference(contour, contourBelow);

  return this.layerDifferences;
}

Layer.prototype.computeInfillDisjointContours = function(resolution, numWalls, force) {
  if (this.infillDisjointContoursReady() && !force) return;

  var below = this.getBelow();
  var above = this.getAbove();

  this.computeLayerDifferences(resolution, numWalls);
  if (above !== null) above.computeLayerDifferences(resolution, numWalls);

  var diffAbove, intAbove;
  if (above !== null) {
    diffAbove = above.layerDifferences.BminusA;
    intAbove = above.layerDifferences.intersection;
  }
  else {
    diffAbove = new MCG.SegmentSet(this.context);
    intAbove = new MCG.SegmentSet(this.context);
  }

  var diffBelow, intBelow;
  diffBelow = this.layerDifferences.AminusB;
  intBelow = this.layerDifferences.intersection;

  var inner = MCG.Boolean.intersection(intAbove, intBelow).intersection;
  var solid = MCG.Boolean.union(diffAbove, diffBelow).union;

  this.infillDisjointContours = {
    inner: inner.toPolygonSet().filter(sliverFilterFn),
    solid: solid.toPolygonSet().filter(sliverFilterFn)
  };

  return this.infillDisjointContours;

  function sliverFilterFn(poly) { return !poly.isSliver(); }
}

Layer.prototype.computeInfill = function(resolution, numWalls, type, density, force) {
  if (this.infillReady() && !force) return;

  this.computeInfillContour(resolution, numWalls);

  var ires = MCG.Math.ftoi(resolution, this.context);
  var iressq = ires*ires;
  var infillInner = null, infillSolid = null;

  // if solid infill, just fill the entire contour
  if (type === Slicer.InfillTypes.solid) {
    infillSolid = MCG.Infill.generate(this.infillContour, MCG.Infill.Types.linear, {
      angle: Math.PI / 4,
      spacing: ires,
      parity: this.idx%2
    });
  }
  // if other infill, need to determine where to fill with that and where to
  // fill with solid infill
  else {
    this.computeInfillDisjointContours(resolution, numWalls);

    var innerContour = this.infillDisjointContours.inner;
    var solidContour = this.infillDisjointContours.solid;

    if (type === Slicer.InfillTypes.grid) {
      infillInner = MCG.Infill.generate(innerContour, MCG.Infill.Types.linear, {
        angle: Math.PI / 4,
        spacing: ires / density,
        parity: this.idx%2
      });
    }

    infillSolid = MCG.Infill.generate(solidContour, MCG.Infill.Types.linear, {
      angle: Math.PI / 4,
      spacing: ires,
      parity: this.idx%2
    });
  }

  // remove infill segments that are too short if infill consists of
  // disconnected lines
  if (type & Slicer.InfillTypes.disconnectedLineType) {
    if (infillInner !== null) infillInner.filter(filterFn);
    if (infillSolid !== null) infillSolid.filter(filterFn);
  };

  this.infill = {
    inner: infillInner,
    solid: infillSolid
  };

  return this.infill;

  function filterFn(segment) { return segment.lengthSq() >= iressq / 4; }
}

Layer.prototype.writeToVerts = function(vertices) {
  // write print contours
  var contours = this.printContours;

  if (contours) {
    for (var c = 0; c < contours.length; c++) {
      contours[c].forEachPointPair(function(p1, p2) {
        vertices.push(p1.toVector3());
        vertices.push(p2.toVector3());
      });
    }
  }

  return;

  var infillInner = this.infill.inner;
  var infillSolid = this.infill.solid;

  // write inner infill
  if (infillInner) {
    infillInner.forEachPointPair(function(p1, p2) {
      vertices.push(p1.toVector3(THREE.Vector3, this.context));
      vertices.push(p2.toVector3(THREE.Vector3, this.context));
    });
  }

  // write solid infill
  if (infillSolid) {
    infillSolid.forEachPointPair(function(p1, p2) {
      vertices.push(p1.toVector3(THREE.Vector3, this.context));
      vertices.push(p2.toVector3(THREE.Vector3, this.context));
    });
  }
}
