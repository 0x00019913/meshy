/* slicer.js */
Slicer = function(vertices, faces, sliceHeight) {
  this.sourceVertices = vertices;
  this.sourceFaces = faces;
  this.sliceHeight = sliceHeight;

  this.previewMeshMaterial = new THREE.MeshStandardMaterial({
    color: 0x6666ff,
    vertexColors: THREE.FaceColors
  });
  this.pathMeshMaterial = new THREE.LineBasicMaterial({
    color: 0x888888,
    linewidth: 1
  });

  this.makePreviewMesh();
  this.makePathMesh();
}

Slicer.prototype.getPreviewMesh = function() {
  return this.previewMesh;
}

Slicer.prototype.getPathMesh = function() {
  return this.pathMesh;
}

Slicer.prototype.makePreviewMesh = function() {
  this.previewFaceBounds = [];
  var previewFaceBounds = this.previewFaceBounds;

  for (var i=0; i<this.faces.length; i++) {
    var face = this.faces[i];
    // always slice on y axis
    var bounds = faceGetBounds(face, "y", this.vertices);

    // store min and max for each face, init state to 0 (fully visible)
    previewFaceBounds.push({
      face: face,
      max: bounds.max,
      min: bounds.min
    });
  }

  // sort by mins
  previewFaceBounds.sort(function(a,b) {
    if (a.max<b.max) return -1;
    else if (a.max>b.max) return 1;
    else return 0;
  });

  // set the face array on this.sliceMesh
  var faces = this.sliceMesh.geometry.faces;
  for (var i=0; i<previewFaceBounds.length; i++) faces.push(previewFaceBounds[i].face);
  this.sliceMesh.geometry.elementsNeedUpdate = true;

  // slices are displaced by half a slice height from mesh extremes, hence -1
  var numSlices = Math.ceil(this.getSizey()/sliceHeight) + 1;

  // to facilitate bookkeeping, set up a separate mesh to contain sliced faces
  // and the patch
  var slicePatchGeo = new THREE.Geometry();
  var slicePatchMesh = new THREE.Mesh(slicePatchGeo, this.materials.sliceMesh);
  slicePatchMesh.name = "model";
  slicePatchMesh.frustumCulled = false;
  this.scene.add(slicePatchMesh);

  // store the following:
  //  faceData for height and state info;
  //  slice height and the number of slices (interdependent)
  //  the current slice index (from 0 to numSlices)
  this.sliceData = {
    faceData: faceData,
    sliceHeight: sliceHeight,
    numSlices: numSlices,
    currentSlice: numSlices
  }

  var geo = new THREE.Geometry();
  geo.vertices = this.vertices.slice();
  // slice preview mesh initialized with no faces; these will be built later
  geo.faces = [];

  this.previewMesh = new THREE.Mesh(geo, this.previewMeshMaterial);
  this.previewMesh.name = "model";
  this.previewMesh.frustumCulled = false;
}

Slicer.prototype.makePathMesh = function() {
  var geo = new THREE.Geometry();
  geo.vertices = [];
  geo.faces = [];

  this.pathMesh = new THREE.LineSegments(geo, this.pathMeshMaterial);
  this.pathMesh.name = "model";
  this.pathMesh.frustumCulled = false;
}
