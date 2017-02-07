AxisWidget = function (sourceCamera) {
  this.sourceCamera = sourceCamera;
  //this.camera = new THREE.PerspectiveCamera(90, 1, 1, 1000);
  this.camera = new THREE.OrthographicCamera(-30,30,30,-30,1,1000);
  this.camera.up = this.sourceCamera.up;
  this.container = document.getElementById("axes");

  this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  this.renderer.setClearAlpha(0);
  this.renderer.setSize(100,100);
  this.container.appendChild(this.renderer.domElement);
  this.scene = new THREE.Scene();

  this.scene.add(new THREE.AxisHelper(25));

  this.origin = new THREE.Vector3(0,0,0);
}

AxisWidget.prototype.update = function() {
  this.camera.position.copy(this.sourceCamera.position);
  this.camera.position.setLength(30);
  this.camera.lookAt(this.origin);
  this.renderer.render(this.scene, this.camera);
}
