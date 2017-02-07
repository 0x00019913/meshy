// Main class representing the Meshy viewport.
// Encompasses:
//   UI interaction
//   displayed meshes (imported and floor mesh)

Stage = function() {
  // toggles
  this.uploadEnabled = true;
  this.floorVisible = true;
  // for keeping track of changes
  this.uploadEnabledOld = true;
  this.floorVisibleOld = true;

  // geometry
  this.model = null;
  this.fileInput = document.getElementById("file");

  // webgl viewport
  this.container = null;
  this.camera = null;
  this.scene = null;
  this.renderer = null;

  // UI
  this.gui = new dat.GUI();
  this.gui.add(this, 'Upload');
  var folderUI = this.gui.addFolder("UI");
  folderUI.add(this, "floorVisible");

  this.initViewport();
  this.initFloor();
}

Stage.prototype.initViewport = function() {
  var width, height;
  var axes;
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

    var pointLight = new THREE.PointLight(0xffffff, 3, 0, 1);
    _this.scene.add(pointLight);
    _this.controls.addObject(pointLight);
    var ambientLight = new THREE.AmbientLight(0xffffff, 1);
    _this.scene.add(ambientLight);

    axes = new AxisWidget(_this.camera);

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
    _this.updateUI();
    _this.controls.update();
    axes.update();
    _this.renderer.render(_this.scene, _this.camera);
  }
}

Stage.prototype.initFloor = function() {
  // Primary: center line thru origin
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

  geoPrimary.vertices.push(new THREE.Vector3(0,0,-30));
  geoPrimary.vertices.push(new THREE.Vector3(0,0,30));
  geoPrimary.vertices.push(new THREE.Vector3(-30,0,0));
  geoPrimary.vertices.push(new THREE.Vector3(30,0,0));
  for (var i=-30; i<=30; i++) {
    if (i==0) continue;
    if (i%5==0) {
      geoSecondary.vertices.push(new THREE.Vector3(i,0,-30));
      geoSecondary.vertices.push(new THREE.Vector3(i,0,30));
      geoSecondary.vertices.push(new THREE.Vector3(-30,0,i));
      geoSecondary.vertices.push(new THREE.Vector3(30,0,i));
    }
    else {
      geoTertiary.vertices.push(new THREE.Vector3(i,0,-30));
      geoTertiary.vertices.push(new THREE.Vector3(i,0,30));
      geoTertiary.vertices.push(new THREE.Vector3(-30,0,i));
      geoTertiary.vertices.push(new THREE.Vector3(30,0,i));
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

Stage.prototype.updateUI = function() {
  if (this.floorVisible!=this.floorVisibleOld) {
    this.floorVisibleOld = this.floorVisible;
    if (this.floorVisible) {
      //turn on floor
        // turn off floor
        this.scene.traverse(function(o) {
          if (o.name=="floor") o.visible = true;
        });
    }
    else {
      // turn off floor
      this.scene.traverse(function(o) {
        if (o.name=="floor") o.visible = false;
      });
    }
  }
}

Stage.prototype.Upload = function() {
  if (this.fileInput) {
    this.fileInput.click();
  }
}

Stage.prototype.handleFile = function(file) {
  this.model = new Model();

  fr = new FileReader();
  fr.onload = function() {
    parseArray(fr.result);
  };
  fr.readAsArrayBuffer(file);

  var _this = this;

  var parseArray = function(array) {
    _this.model.numSlices = parseInt(30);

    // mimicking http://tonylukasavage.com/blog/2013/04/10/web-based-stl-viewing-three-dot-js/
    var dv = new DataView(array, 80);
    var isLittleEndian = true;

    var offset = 4;
    var n = dv.getUint32(0, isLittleEndian);
    for (var tri=0; tri<n; tri++) {
      var triangle = new Triangle();

      triangle.setNormal(getVector3(dv, offset, isLittleEndian));
      offset += 12;

      for (var vert=0; vert<3; vert++) {
        triangle.addVertex(getVector3(dv, offset, isLittleEndian));
        offset += 12;
      }

      // ignore "attribute byte count" (2 bytes)
      offset += 2;
      _this.model.add(triangle);
    }

    _this.displayMesh();
  };

  var getVector3 = function(dv, offset, isLittleEndian) {
    return new THREE.Vector3(
      dv.getFloat32(offset, isLittleEndian),
      dv.getFloat32(offset+4, isLittleEndian),
      dv.getFloat32(offset+8, isLittleEndian)
    );
  }
}


Stage.prototype.displayMesh = function() {
  var center = this.model.getCenter();
  this.model.renderPlainModel(this.scene);
  //model.renderLineModel(scene);
  this.controls.update( {origin: new THREE.Vector3(center[0],center[1],center[2])} );
}
