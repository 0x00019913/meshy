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

  this.scene.add(new THREE.AmbientLight(0xffffff, 1));

  this.scene.add(new THREE.AxisHelper(22));

  var _this = this;
  var fontLoader = new THREE.FontLoader();
  fontLoader.load('./js/helvetiker_regular.typeface.json', function (font) {
    var params = {
      font: font,
      size: 7,
      height: 1
    };
    var geoX = new THREE.TextGeometry("x", params);
    var geoY = new THREE.TextGeometry("y", params);
    geoY.rotateY(-3*Math.PI/4);
    var geoZ = new THREE.TextGeometry("z", params);
    geoZ.rotateY(-Math.PI/2);
    geoX.translate(24,-3,-2);
    geoY.translate(2,26,0);
    geoZ.translate(0,-3,25);
    var matX = new THREE.MeshPhongMaterial({color: 0xff3333});
    var matY = new THREE.MeshPhongMaterial({color: 0x33ff33});
    var matZ = new THREE.MeshPhongMaterial({color: 0x3333ff});
    var meshX = new THREE.Mesh(geoX, matX);
    var meshY = new THREE.Mesh(geoY, matY);
    var meshZ = new THREE.Mesh(geoZ, matZ);
    _this.scene.add(meshX);
    _this.scene.add(meshY);
    _this.scene.add(meshZ);
  });

  this.origin = new THREE.Vector3(0,0,0);
}

AxisWidget.prototype.update = function() {
  this.camera.position.copy(this.sourceCamera.getWorldDirection());
  this.camera.position.setLength(30);
  this.camera.lookAt(this.origin);
  this.renderer.render(this.scene, this.camera);
}
