/* slicer.js */
Slicer = function(scene, vertices, faces) {
  this.scene = scene;
  this.sourceVertices = vertices;
  this.sourceFaces = faces;

  // materials used by the slicer
  this.materials = {
    previewMesh: new THREE.MeshStandardMaterial({
      color: 0x6666ff,
      vertexColors: THREE.FaceColors
    }),
    patch: new THREE.MeshStandardMaterial({
      color: 0x44ff44,
      wireframe: false
    })
  };

  this.makePreviewMesh();
}

Slicer.prototype.makePreviewMesh = function() {
  var geo = new THREE.Geometry();
  geo.vertices = this.vertices.slice();
  // slice preview mesh initialized with no faces; these will be built later
  geo.faces = [];
  this.previewMesh = new THREE.Mesh(geo, this.materials.previewMesh);
  this.previewMesh.name = "model";
  this.previewMesh.frustumCulled = false;
}

Slicer.prototype.makeLineMesh = function() {

}
