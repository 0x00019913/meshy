// Main class representing the Meshy viewport.
// Encompasses:
//   UI interaction
//   displayed meshes (imported and floor mesh)

Stage = function() {
  // params
  this.floorSize = 50;

  // toggles
  this.uploadEnabled = true;
  this.floorVisible = true;

  // geometry
  this.model = null;
  this.fileInput = document.getElementById("file");
  this.isLittleEndian = true;

  // webgl viewport
  this.container = null;
  this.camera = null;
  this.scene = null;
  this.renderer = null;
  this.axisWidget = null;
  this.printout = new Printout();

  // undo stack
  this.undoStack = new UndoStack(this.printout);

  // UI
  this.generateUI();
}

Stage.prototype.generateUI = function() {
  this.gui = new dat.GUI();
  this.gui.add(this, "upload");
  this.gui.add(this, "undo");

  var exportFolder = this.gui.addFolder("Export");
  this.filename = "meshy";
  this.filenameController = exportFolder.add(this, "filename");
  exportFolder.add(this, "exportOBJ");
  exportFolder.add(this, "exportSTL");

  var settingsFolder = this.gui.addFolder("Settings");
  settingsFolder.add(this, "toggleFloor");
  settingsFolder.add(this, "toggleAxisWidget");
  settingsFolder.add(this, "isLittleEndian");
  var transformFolder = this.gui.addFolder("Transform");
  var translateFolder = transformFolder.addFolder("Translate");
  this.xTranslation = 0;
  translateFolder.add(this, "xTranslation");
  translateFolder.add(this, "translateX");
  this.yTranslation = 0;
  translateFolder.add(this, "yTranslation");
  translateFolder.add(this, "translateY");
  this.zTranslation = 0;
  translateFolder.add(this, "zTranslation");
  translateFolder.add(this, "translateZ");
  var rotateFolder = transformFolder.addFolder("Rotate");
  this.xRotation = 0;
  rotateFolder.add(this, "xRotation");
  rotateFolder.add(this, "rotateX");
  this.yRotation = 0;
  rotateFolder.add(this, "yRotation");
  rotateFolder.add(this, "rotateY");
  this.zRotation = 0;
  rotateFolder.add(this, "zRotation");
  rotateFolder.add(this, "rotateZ");
  var scaleFolder = transformFolder.addFolder("Scale");
  this.xScale = 1;
  scaleFolder.add(this, "xScale", 0);
  scaleFolder.add(this, "scaleX");
  this.yScale = 1;
  scaleFolder.add(this, "yScale", 0);
  scaleFolder.add(this, "scaleY");
  this.zScale = 1;
  scaleFolder.add(this, "zScale", 0);
  scaleFolder.add(this, "scaleZ");
  this.allScale = 1;
  scaleFolder.add(this, "allScale", 0);
  scaleFolder.add(this, "scaleAll");
  var floorFolder = transformFolder.addFolder("Floor");
  floorFolder.add(this, "floorX");
  floorFolder.add(this, "floorY");
  floorFolder.add(this, "floorZ");
  var centerFolder = transformFolder.addFolder("Center");
  centerFolder.add(this, "centerAll");
  centerFolder.add(this, "centerX");
  centerFolder.add(this, "centerY");
  centerFolder.add(this, "centerZ");
  var calculationFolder = this.gui.addFolder("Calculation");
  calculationFolder.add(this, "calcSurfaceArea");
  calculationFolder.add(this, "calcVolume");
  calculationFolder.add(this, "calcCenterOfMass");
  var measurementFolder = this.gui.addFolder("Measurement");
  measurementFolder.add(this, "mSegmentLength");
  measurementFolder.add(this, "mAngle");
  measurementFolder.add(this, "mRadius");
  measurementFolder.add(this, "mArcLength");
  measurementFolder.add(this, "mDeactivate");
  var displayFolder = this.gui.addFolder("Display");
  displayFolder.add(this, "toggleCOM");
  displayFolder.add(this, "toggleWireframe");
  displayFolder.add(this, "cameraToModel");
  this.gui.add(this, "delete");

  this.infoBox = new InfoBox();
  this.infoBox.add("Polycount", this, ["model","count"]);
  this.infoBox.addMultiple("x range", this, [["model","xmin"], ["model","xmax"]]);
  this.infoBox.addMultiple("y range", this, [["model","ymin"], ["model","ymax"]]);
  this.infoBox.addMultiple("z range", this, [["model","zmin"], ["model","zmax"]]);
  this.infoBox.addMultiple("Center", this, [["model", "getCenterx"],["model", "getCentery"],["model", "getCenterz"]]);
  this.infoBox.addMultiple("Size", this, [["model", "getSizex"],["model", "getSizey"],["model", "getSizez"]]);
  this.infoBox.add("Surface area", this, ["model","surfaceArea"],"[calculate]");
  this.infoBox.add("Volume", this, ["model", "volume"], "[calculate]");
  this.infoBox.addMultiple("Center of mass", this, [["model","getCOMx"], ["model","getCOMy"], ["model","getCOMz"]], "[calculate]");

  this.initViewport();
  this.initFloor();
}

// anything that needs to be refreshed by hand (not in every frame)
Stage.prototype.updateUI = function() {
  this.filenameController.updateDisplay();
}

Stage.prototype.transform = function(op, axis, amount) {
  var transform = new Transform(op, axis, amount, this.model, this.printout);
  var inv = transform.makeInverse();
  if (inv) this.undoStack.push(inv);
  transform.apply();
}

Stage.prototype.exportOBJ = function() { this.export("obj"); }
Stage.prototype.exportSTL = function() { this.export("stl"); }

Stage.prototype.undo = function() { this.undoStack.undo(); }

Stage.prototype.translateX = function() { this.transform("translate","x",this.xTranslation); }
Stage.prototype.translateY = function() { this.transform("translate","y",this.yTranslation); }
Stage.prototype.translateZ = function() { this.transform("translate","z",this.zTranslation); }
Stage.prototype.rotateX = function() { this.transform("rotate","x",this.xRotation); }
Stage.prototype.rotateY = function() { this.transform("rotate","y",this.yRotation); }
Stage.prototype.rotateZ = function() { this.transform("rotate","z",this.zRotation); }
Stage.prototype.scaleX = function() { this.transform("scale","x",this.xScale); }
Stage.prototype.scaleY = function() { this.transform("scale","y",this.yScale); }
Stage.prototype.scaleZ = function() { this.transform("scale","z",this.zScale); }
Stage.prototype.scaleAll = function() {
  this.transform("scale","all",[this.allScale, this.allScale, this.allScale]); }
Stage.prototype.floorX = function() { this.transform("floor","x",null); }
Stage.prototype.floorY = function() { this.transform("floor","y",null); }
Stage.prototype.floorZ = function() { this.transform("floor","z",null); }
Stage.prototype.centerAll = function() { this.transform("center","all",null); }
Stage.prototype.centerX = function() { this.transform("center","x",null); }
Stage.prototype.centerY = function() { this.transform("center","y",null); }
Stage.prototype.centerZ = function() { this.transform("center","z",null); }
Stage.prototype.calcSurfaceArea = function() { if (this.model) this.model.calcSurfaceArea(); }
Stage.prototype.calcVolume = function() { if (this.model) this.model.calcVolume(); }
Stage.prototype.calcCenterOfMass = function() { if (this.model) this.model.calcCenterOfMass(); }
Stage.prototype.mSegmentLength = function() { this.startMeasurement("segmentLength"); }
Stage.prototype.mAngle = function() { this.startMeasurement("angle"); }
Stage.prototype.mRadius = function() { this.startMeasurement("radius"); }
Stage.prototype.mArcLength = function() { this.startMeasurement("arcLength"); }
Stage.prototype.startMeasurement = function(type) {
  if (this.model) {
    this.printout.log("Measurement activated.");
    this.model.measurement.activate(type);
  }
}
Stage.prototype.mDeactivate = function() {
  if (this.model) {
    this.printout.log("Measurement deactivated.");
    this.model.measurement.deactivate();
  }
}

Stage.prototype.toggleFloor = function() {
  this.floorVisible = !this.floorVisible;
  var visible = this.floorVisible;
  this.scene.traverse(function(o) {
    if (o.name=="floor") o.visible = visible;
  });
}
Stage.prototype.toggleCOM = function() {
  if (this.model) {
    this.model.toggleCenterOfMass();
  }
}
Stage.prototype.toggleWireframe = function() {
  this.transform("toggleWireframe",null,null,this.model);
}
Stage.prototype.toggleAxisWidget = function() {
  this.axisWidget.toggleVisibility();
}

Stage.prototype.initViewport = function() {
  var width, height;
  var _this = this;

  init();
  animate();

  function init() {
    _this.container = document.getElementById('container');
    height = container.offsetHeight;
    width = container.offsetWidth;

    _this.camera = new THREE.PerspectiveCamera(30, width/height, .1, 100000);

    _this.scene = new THREE.Scene();
    _this.scene.background = new THREE.Color(0x222222);

    _this.controls = new Controls(
      _this.camera,
      _this.container,
      {
        r: 10,
        phi: Math.PI/3,
        theta: 5*Math.PI/12
      }
    );

    var pointLight = new THREE.PointLight(0xffffff, 3);
    _this.scene.add(pointLight);
    _this.controls.addObject(pointLight);
    var ambientLight = new THREE.AmbientLight(0xffffff, 0.1);
    _this.scene.add(ambientLight);

    _this.axisWidget = new AxisWidget(_this.camera);

    _this.controls.update();

    /* RENDER */
    _this.renderer = new THREE.WebGLRenderer({ antialias: true });
    _this.renderer.shadowMap.enabled = true;
    _this.renderer.toneMapping = THREE.ReinhardToneMapping;
    _this.renderer.setPixelRatio(window.devicePixelRatio);
    _this.renderer.setSize(width, height);
    _this.container.appendChild(_this.renderer.domElement);

    addEventListeners();
  }

  function addEventListeners() {
    window.addEventListener('resize', onWindowResize, false);
  }

  function onWindowResize() {
    height = _this.container.offsetHeight;
    width = _this.container.offsetWidth;
    _this.camera.aspect = width / height;
    _this.camera.updateProjectionMatrix();

    _this.renderer.setSize(width, height);
  }

  function animate() {
    requestAnimationFrame(animate);
    render();
  }

  function render() {
    if (!_this.camera || !_this.scene) return;
    _this.controls.update();
    _this.axisWidget.update();
    _this.infoBox.update();
    _this.renderer.render(_this.scene, _this.camera);
  }
}

Stage.prototype.initFloor = function() {
  var size = this.floorSize;

  // Primary: center line through origin
  // Secondary: lines along multiples of 5
  // Tertiary: everything else
  var geoPrimary = new THREE.Geometry();
  var matPrimary = new THREE.LineBasicMaterial({
    color: 0xdddddd,
    linewidth: 1
  });
  var geoSecondary = new THREE.Geometry();
  var matSecondary = new THREE.LineBasicMaterial({
    color: 0x777777,
    linewidth: 1
  });
  var geoTertiary = new THREE.Geometry();
  var matTertiary = new THREE.LineBasicMaterial({
    color: 0x444444,
    linewidth: 1
  });

  geoPrimary.vertices.push(new THREE.Vector3(0,0,-size));
  geoPrimary.vertices.push(new THREE.Vector3(0,0,size));
  geoPrimary.vertices.push(new THREE.Vector3(-size,0,0));
  geoPrimary.vertices.push(new THREE.Vector3(size,0,0));
  for (var i=-size; i<=size; i++) {
    if (i==0) continue;
    if (i%5==0) {
      geoSecondary.vertices.push(new THREE.Vector3(i,0,-size));
      geoSecondary.vertices.push(new THREE.Vector3(i,0,size));
      geoSecondary.vertices.push(new THREE.Vector3(-size,0,i));
      geoSecondary.vertices.push(new THREE.Vector3(size,0,i));
    }
    else {
      geoTertiary.vertices.push(new THREE.Vector3(i,0,-size));
      geoTertiary.vertices.push(new THREE.Vector3(i,0,size));
      geoTertiary.vertices.push(new THREE.Vector3(-size,0,i));
      geoTertiary.vertices.push(new THREE.Vector3(size,0,i));
    }
  }
  var linePrimary = new THREE.LineSegments(geoPrimary, matPrimary);
  var lineSecondary = new THREE.LineSegments(geoSecondary, matSecondary);
  var lineTertiary = new THREE.LineSegments(geoTertiary, matTertiary);
  linePrimary.name = "floor";
  lineSecondary.name = "floor";
  lineTertiary.name = "floor";
  this.scene.add(linePrimary);
  this.scene.add(lineSecondary);
  this.scene.add(lineTertiary);
}

// interface for the button in the gui
Stage.prototype.upload = function() {
  if (this.model) {
    this.printout.warn("A model is already loaded; delete the current model to upload a new one.");
    return;
  }

  if (this.fileInput) {
    this.fileInput.click();
  }
}

// called from HTML when the upload button is clicked
Stage.prototype.handleFile = function(file) {
  this.model = new Model(this.scene, this.camera, this.container, this.printout, this.infoBox);
  this.model.isLittleEndian = this.isLittleEndian;
  this.model.upload(file, this.displayMesh.bind(this));
};

Stage.prototype.export = function(format) {
  if (!this.model) {
    this.printout.warn("No model to export.");
    return;
  }

  this.model.export(format, this.filename);
}

Stage.prototype.delete = function() {
  // it's necessary to clear file input box because it blocks uploading
  // a model with the same name twice in a row
  this.fileInput.value = "";

  if (this.model) {
    this.model.dispose();
  }
  else {
    this.printout.warn("No model to delete.");
    return;
  }
  this.model = null;
  this.undoStack.clear();

  this.printout.log("Model deleted.");
}

Stage.prototype.displayMesh = function(success) {
  if (!success) {
    this.model = null;
    return;
  }
  this.model.render(this.scene, "plain");
  this.cameraToModel();
  this.filename = this.model.filename;
  this.updateUI();
}

Stage.prototype.cameraToModel = function() {
  if (!this.model) {
    this.printout.warn("No model to align camera.");
    return;
  }
  var center = this.model.getCenter();
  this.controls.update({
    origin: new THREE.Vector3(center[0],center[1],center[2]),
    r: this.model.getMaxSize() * 3 // factor of 3 empirically determined
  });
}
