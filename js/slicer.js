/* slicer.js */
Slicer = function(vertices, faces, params) {
  this.sourceVertices = vertices;
  this.sourceFaces = faces;
  this.vertexCount = vertices.length;
  this.faceCount = faces.length;
  this.sliceHeight = 0.5;
  this.axis = "z";
  this.mode = "preview";

  // set from params
  if (params) {
    if (params.hasOwnProperty("sliceHeight")) this.sliceHeight = params.sliceHeight;
    if (params.hasOwnProperty("axis")) this.axis = params.axis;
    if (params.hasOwnProperty("mode")) this.mode = params.mode;
  }

  // 1. assume right-handed coords
  // 2. look along negative this.axis with the other axes pointing up and right
  // then this.axis1 points right and this.axis2 points up
  this.axis1 = this.axis=="x" ? "y" : this.axis=="y" ? "z" : "x";
  this.axis2 = this.axis=="x" ? "z" : this.axis=="y" ? "x" : "y";

  this.previewMeshMaterial = new THREE.MeshStandardMaterial({
    color: 0x6666ff
  });
  this.transparentMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0
  });
  this.pathMeshMaterial = new THREE.LineBasicMaterial({
    color: 0x888888,
    linewidth: 1
  });

  this.calculateFaceBounds();

  this.makePreviewMesh();
  this.makePathMesh();
}

Slicer.prototype.getMesh = function() {
  if (this.mode=="preview") return this.previewMesh;
  else if (this.mode=="path") return this.pathMesh;
}

Slicer.prototype.getNumSlices = function() {
  return this.numSlices;
}

Slicer.prototype.getCurrentSlice = function() {
  return this.currentSlice;
}

Slicer.prototype.setSlice = function(slice) {
  var sliceLevel = this.min + (slice-0.5) * this.sliceHeight;
  var faceBounds = this.faceBounds;

  // array of faces that intersect the slicing plane
  var slicedFaces = [];

  for (var i = this.faceCount-1; i >= 0; i--) {
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

  // update because we changed material indices
  var previewMesh = this.previewMesh;
  previewMesh.geometry.groupsNeedUpdate = true;

  // handle the sliced faces: slice them and insert them (and assicated verts)
  // into previewMesh
  var vertices = previewMesh.geometry.vertices;
  var faces = previewMesh.geometry.faces;
  var axis = this.axis;
  var compare = axisCompare.bind(this);

  // erase any sliced verts and faces
  vertices.length = this.vertexCount;
  faces.length = this.faceCount;

  for (var f = 0; f < slicedFaces.length; f++) {
    var verts = faceGetVerts(slicedFaces[f], vertices);
    var va = verts[0], vb = verts[1];
    verts.sort(compare);
    // check if the winding order got flipped by sorting (default is CCW)
    var ccw = (verts[0]==va && verts[1]==vb);
    ccw = ccw || (verts[1]==va && verts[2]==vb);
    ccw = ccw || (verts[2]==va && verts[0]==vb);

    // in the following, A is the bottom vert, B is the middle vert, and XY
    // are the points there the triangle intersects the X-Y segment

    // if middle vert is greater than slice level, slice into 1 triangle A-AB-AC
    if (verts[1][axis] > sliceLevel) {
      // calculate intersection of A-B and A-C
      var AB = segmentPlaneIntersection(axis, sliceLevel, verts[0], verts[1]);
      var AC = segmentPlaneIntersection(axis, sliceLevel, verts[0], verts[2]);
      // get indices of these verts in the vert array before pushing them there
      var idxA = vertices.length;
      var idxAB = idxA + 1;
      var idxAC = idxA + 2;
      vertices.push(verts[0]);
      vertices.push(AB);
      vertices.push(AC);

      // create the new face and push it into the faces array
      var newFace;
      if (ccw) newFace = new THREE.Face3(idxA, idxAB, idxAC);
      else newFace = new THREE.Face3(idxA, idxAC, idxAB);
      // explicitly visible
      newFace.materialIndex = 0;
      // compute normal
      faceComputeNormal(newFace, vertices);

      faces.push(newFace);
    }
    // else, slice into two triangles: A-B-AC and B-BC-AC
    else {
      // calculate intersection of A-C and B-C
      var AC = segmentPlaneIntersection(axis, sliceLevel, verts[0], verts[2]);
      var BC = segmentPlaneIntersection(axis, sliceLevel, verts[1], verts[2]);
      // get indices of these verts in the vert array before pushing them there
      var idxA = vertices.length;
      var idxB = idxA + 1;
      var idxAC = idxA + 2;
      var idxBC = idxA + 3;
      vertices.push(verts[0]);
      vertices.push(verts[1]);
      vertices.push(AC);
      vertices.push(BC);

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
      // explicitly visible
      newFace1.materialIndex = 0;
      newFace2.materialIndex = 0;
      // compute normals
      faceComputeNormal(newFace1, vertices);
      faceComputeNormal(newFace2, vertices);

      faces.push(newFace1);
      faces.push(newFace2);
    }
  }

  previewMesh.geometry.elementsNeedUpdate = true;

  function axisCompare(va,vb) {
    var axis = this.axis;
    var acomp = va[axis], bcomp = vb[axis];
    if (acomp < bcomp) return -1;
    else if (acomp > bcomp) return 1;
    else return 0;
  }
}

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

  // sort by maxes
  faceBounds.sort(function(a,b) {
    if (a.max<b.max) return -1;
    else if (a.max>b.max) return 1;
    else return 0;
  });

  this.min = min;
  this.max = max;
  // slices are displaced by half a slice height from mesh extremes, hence +1
  this.numSlices = Math.ceil((max - min) / this.sliceHeight) + 1;
  this.currentSlice = this.numSlices;
}

Slicer.prototype.makePreviewMesh = function() {
  // create the mesh
  var geo = new THREE.Geometry();
  geo.vertices = this.sourceVertices.slice();
  // slice preview mesh initialized with no faces; these will be built later
  var faces = [];
  geo.faces = faces;

  // each face in the preview mesh will have one of these materials
  var faceMaterials = [
    // set materialIndex = 0 to make a face visible
    this.previewMeshMaterial,
    // set materialindex = 1 to hide a face
    this.transparentMaterial
  ];

  var previewMesh = new THREE.Mesh(geo, faceMaterials);
  previewMesh.name = "model";
  previewMesh.frustumCulled = false;

  // set the face array on the mesh
  for (var i=0; i<this.faceBounds.length; i++) {
    var face = this.faceBounds[i].face;
    face.materialIndex = 0; // explicitly set as visible by default
    faces.push(face);
  }

  this.previewMesh = previewMesh;
}

Slicer.prototype.makePathMesh = function() {
  var geo = new THREE.Geometry();
  geo.vertices = [];
  geo.faces = [];

  this.pathMesh = new THREE.LineSegments(geo, this.pathMeshMaterial);
  this.pathMesh.name = "model";
  this.pathMesh.frustumCulled = false;
}
