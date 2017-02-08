function Model() {
  // internal geometry
  this.triangles = [];
  this.count = 0;
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;

  // calculated stuff
  this.xmin = null;
  this.xmax = null;
  this.ymin = null;
  this.ymax = null;
  this.zmin = null;
  this.zmax = null;

  // for slicing
  this.sliceCount = null;
  this.numSlices = 30;
  this.delta = null;
  this.segmentLists = null;

  // for display
  this.wireframe = false;
  this.currentMesh = null;
  this.plainMesh = null;
  this.slicedMesh = null;
  this.scene = null;
}

Model.prototype.add = function(triangle) {
  this.triangles.push(triangle);
  this.count++;
  if (this.count==1) {
    this.xmin = triangle.xmin;
    this.xmax = triangle.xmax;
    this.ymin = triangle.ymin;
    this.ymax = triangle.ymax;
    this.zmin = triangle.zmin;
    this.zmax = triangle.zmax;
  }
  else {
    this.updateBounds(triangle);
  }
}

Model.prototype.updateBounds = function(triangle) {
  this.xmin = triangle.xmin<this.xmin ? triangle.xmin : this.xmin;
  this.xmax = triangle.xmax>this.xmax ? triangle.xmax : this.xmax;
  this.ymin = triangle.ymin<this.ymin ? triangle.ymin : this.ymin;
  this.ymax = triangle.ymax>this.ymax ? triangle.ymax : this.ymax;
  this.zmin = triangle.zmin<this.zmin ? triangle.zmin : this.zmin;
  this.zmax = triangle.zmax>this.zmax ? triangle.zmax : this.zmax;
}

Model.prototype.getCenter = function() {
  return [
    this.getCenterx(),
    this.getCentery(),
    this.getCenterz()
  ];
}
Model.prototype.getCenterx = function() { return (this.xmax+this.xmin)/2; }
Model.prototype.getCentery = function() { return (this.ymax+this.ymin)/2; }
Model.prototype.getCenterz = function() { return (this.zmax+this.zmin)/2; }

Model.prototype.translate = function(axis, amount) {
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.translate(axis, amount);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;
}

Model.prototype.rotate = function(axis, amount) {
  console.log(axis, amount);
}

Model.prototype.toggleWireframe = function() {
  this.wireframe = !this.wireframe;
  if (this.plainMesh) {
    this.plainMesh.material.wireframe = this.wireframe;
  }
}

Model.prototype.render = function(scene, mode) {
  this.scene = scene;
  if (mode == "plain") {
    this.renderPlainModel(scene);
    this.currentMesh = this.plainMesh;
  }
  else if (mode == "sliced") {
    if (!this.segmentLists) {
      this.segmentLists = this.slice();
    }
    this.renderSlicedModel(scene);
    this.currentMesh = this.slicedMesh;
  }
}

Model.prototype.renderPlainModel = function(scene) {
  if (this.plainMesh) return;
  /* set up camera, put in model */
  var geo = new THREE.Geometry();
  for (var i=0; i<this.count; i++) {
    for (j=0; j<3; j++) {
      geo.vertices.push(this.triangles[i].vertices[j]);
    }
    geo.faces.push(new THREE.Face3(i*3, i*3+1, i*3+2, this.triangles[i].normal));
  }
  var mat = new THREE.MeshStandardMaterial({
    color: 0xffffff
  });
  this.plainMesh = new THREE.Mesh(geo, mat);
  this.plainMesh.name = "model";
  this.plainMesh.frustumCulled = false;
  scene.add(this.plainMesh);
}

/* renders line segments in the "set" argument */
Model.prototype.renderSlicedModel = function(scene) {
  this.segmentLists = this.slice();
  var geo = new THREE.Geometry();
  for (var i=0; i<this.segmentLists.length; i++) {
    for (var j=0; j<this.segmentLists[i].length; j++) {
      geo.vertices.push(this.segmentLists[i][j][0]);
      geo.vertices.push(this.segmentLists[i][j][1]);
    }
  }
  var mat = new THREE.LineBasicMaterial({
    color: 0x0,
    linewidth: 1
  });
  this.slicedMesh = new THREE.LineSegments(geo, mat);
  this.slicedMesh.name = "model";
  scene.add(this.slicedMesh);
}

Model.prototype.upload = function(file, callback) {
  var _this = this;

  fr = new FileReader();
  fr.onload = function() {
    parseArray(fr.result);
    callback();
  };
  fr.readAsArrayBuffer(file);

  var parseArray = function(array) {
    // mimicking http://tonylukasavage.com/blog/2013/04/10/web-based-stl-viewing-three-dot-js/
    _this.header = array.slice(0, 80); // store header

    var dv = new DataView(array, 80);
    var isLittleEndian = _this.isLittleEndian;

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
      _this.add(triangle);
    }

    function getVector3(dv, offset, isLittleEndian) {
      return new THREE.Vector3(
        dv.getFloat32(offset, isLittleEndian),
        dv.getFloat32(offset+4, isLittleEndian),
        dv.getFloat32(offset+8, isLittleEndian)
      );
    }
  }
}

Model.prototype.delete = function() {
  var _scene = this.scene;
  _scene.traverse(function(o) {
    if (o.name=="model") {
      _scene.remove(o);
    }
  });
}

Model.prototype.buildSliceLists = function() {
  // slice thickness
  this.delta = (this.ymax-this.ymin)/this.numSlices;
  var slice0 = this.ymin + this.delta/2;
  var slicek = this.ymax - this.delta/2;
  var sliceLists = [];
  // initialize sliceLists
  for (var i=0; i<=this.numSlices; i++) {
    sliceLists[i] = [];
  }
  for (var i=0; i<this.count; i++) {
    var index;
    var triangle = this.triangles[i];
    if (triangle.ymin<slice0) index = 0;
    else if (triangle.ymin>slicek) index = this.numSlices;
    else index = Math.floor((triangle.ymin-slice0)/this.delta) + 1;
    sliceLists[index].push(triangle);
  }

  return sliceLists;
}

Model.prototype.slice = function() {
  var sliceLists = this.buildSliceLists();
  var sweepList = [];
  var segmentLists = [];

  var intersectingList = [];
  for (var i=0; i<this.numSlices; i++) {
    sweepList = sweepList.concat(sliceLists[i]);
    segmentLists[i] = [];
    var slicePos = this.ymin + (i+0.5)*this.delta;
    for (var j=0; j<sweepList.length; j++) {
      if (sweepList[j].ymax<slicePos) {
        sweepList.splice(j,1); // crude but should work
      }
      else {
        var intersection = sweepList[j].yIntersection(slicePos);
        segmentLists[i].push(intersection);
      }
    }
  }
  return segmentLists;
}
