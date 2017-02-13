function Model() {
  // internal geometry
  this.triangles = [];
  this.count = 0;
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;

  // calculated stuff
  this.resetBounds(); // sets bounds to Infinity
  this.surfaceArea = null;
  this.volume = null;
  this.centerOfMass = null;

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
  // three orthogonal planes that intersect at the center of the mesh
  this.targetPlanes = null;
  this.showCenterOfMass = false;
}

Model.prototype.add = function(triangle) {
  this.triangles.push(triangle);
  this.count++;
  this.updateBounds(triangle);
}

Model.prototype.resetBounds = function() {
  this.xmin = Infinity;
  this.xmax = -Infinity;
  this.ymin = Infinity;
  this.ymax = -Infinity;
  this.zmin = Infinity;
  this.zmax = -Infinity;
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
Model.prototype.getSize = function() {
  return [
    this.getSizex(),
    this.getSizey(),
    this.getSizez()
  ];
}
Model.prototype.getSizex = function() { return (this.xmax-this.xmin); }
Model.prototype.getSizey = function() { return (this.ymax-this.ymin); }
Model.prototype.getSizez = function() { return (this.zmax-this.zmin); }
Model.prototype.getMaxSize = function() {
  var size = this.getSize();
  return Math.max(size[0], Math.max(size[1], size[2]));
}
Model.prototype.getMinSize = function() {
  var size = this.getSize();
  return Math.min(size[0], Math.min(size[1], size[2]));
}
Model.prototype.getCOMx = function() {
  if (this.centerOfMass) return this.centerOfMass[0];
  return null;
}
Model.prototype.getCOMy = function() {
  if (this.centerOfMass) return this.centerOfMass[1];
  return null;
}
Model.prototype.getCOMz = function() {
  if (this.centerOfMass) return this.centerOfMass[2];
  return null;
}

Model.prototype.translate = function(axis, amount) {
  console.log("translate", axis, amount);
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.translate(axis, amount);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  //transform bounds
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;

  if (this.centerOfMass) {
    // transform center of mass
    var vector3COM = new THREE.Vector3();
    vector3COM.fromArray(this.centerOfMass);
    vector3COM[axis] += amount;
    this.centerOfMass = vector3COM.toArray();
    this.positionTargetPlanes(this.centerOfMass);
  }
}

Model.prototype.rotate = function(axis, amount) {
  this.resetBounds();
  amount = amount*Math.PI/180.0;
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.rotate(axis, amount);
    this.updateBounds(tri);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  if (this.centerOfMass) {
    // transform center of mass
    var vector3COM = new THREE.Vector3();
    vector3COM.fromArray(this.centerOfMass);
    vector3COM.applyAxisAngle(this.axes[axis],amount);
    this.centerOfMass = vector3COM.toArray();
    this.positionTargetPlanes(this.centerOfMass);
  }
}
// for turning "x" etc. into a normalized Vector3 along axis
Model.prototype.axes = {
  x: new THREE.Vector3(1,0,0),
  y: new THREE.Vector3(0,1,0),
  z: new THREE.Vector3(0,0,1),
}

Model.prototype.scale = function (axis, amount) {
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.scale(axis, amount);
    tri.surfaceArea = null;
    tri.volume = null;
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.surfaceArea = null;
  this.volume = null;
  this[axis+"min"] *= amount;
  this[axis+"max"] *= amount;
  if (this.centerOfMass) {
    // transform center of mass
    var vector3COM = new THREE.Vector3();
    vector3COM.fromArray(this.centerOfMass);
    vector3COM[axis] *= amount;
    this.centerOfMass = vector3COM.toArray();
    this.positionTargetPlanes(this.centerOfMass);
  }
}

Model.prototype.toggleWireframe = function() {
  this.wireframe = !this.wireframe;
  if (this.plainMesh) {
    this.plainMesh.material.wireframe = this.wireframe;
  }
}

Model.prototype.calcSurfaceArea = function() {
  this.surfaceArea = 0;
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    this.surfaceArea += tri.calcSurfaceArea();
  }
  return this.surfaceArea;
}

Model.prototype.calcVolume = function() {
  this.volume = 0;
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    this.volume += tri.calcSignedVolume();
  }
}

Model.prototype.calcCenterOfMass = function() {
  if (this.centerOfMass) return this.centerOfMass;
  var modelVolume = 0, triVolume = 0;
  var center = [0,0,0];
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    var verts = tri.vertices;
    triVolume = tri.calcSignedVolume();
    modelVolume += triVolume;
    center[0] += ((verts[0].x + verts[1].x + verts[2].x) / 4) * triVolume;
    center[1] += ((verts[0].y + verts[1].y + verts[2].y) / 4) * triVolume;
    center[2] += ((verts[0].z + verts[1].z + verts[2].z) / 4) * triVolume;
  }
  this.volume = modelVolume;
  this.centerOfMass = center.map(function(x) {return x/modelVolume});
}

Model.prototype.toggleCenterOfMass = function() {
  this.calcCenterOfMass();
  this.showCenterOfMass = !this.showCenterOfMass;
  var visible = this.showCenterOfMass;
  this.positionTargetPlanes(this.centerOfMass);
  this.scene.traverse(function(o) {
    if (o.name == "targetPlane") o.visible = visible;
  });
}

Model.prototype.generateTargetPlanes = function() {
  var size = 1;
  this.targetPlanes = [
    new THREE.PlaneGeometry(size,size).rotateY(Math.PI/2), // normal x
    new THREE.PlaneGeometry(size,size).rotateX(Math.PI/2), // normal y
    new THREE.PlaneGeometry(size,size) // normal z
  ];
  var planeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  planeMat.transparent = true;
  planeMat.opacity = 0.5;
  var planeMeshes = [
    new THREE.Mesh(this.targetPlanes[0], planeMat),
    new THREE.Mesh(this.targetPlanes[1], planeMat),
    new THREE.Mesh(this.targetPlanes[2], planeMat)
  ];
  for (var i=0; i<planeMeshes.length; i++) {
    planeMeshes[i].name = "targetPlane";
    planeMeshes[i].visible = false;
    this.scene.add(planeMeshes[i]);
  }
}

Model.prototype.positionTargetPlanes = function(point) {
  if (!this.targetPlanes) this.generateTargetPlanes();

  var vX = this.targetPlanes[0].vertices;
  var vY = this.targetPlanes[1].vertices;
  var vZ = this.targetPlanes[2].vertices;
  // arrange that the planes protrude from the boundaries of the object
  // by 0.1 times its size
  var extendFactor = 0.1;
  var size = this.getSize().map(function(x) { return x*=extendFactor; });
  var xmin = this.xmin-size[0], xmax = this.xmax+size[0];
  var ymin = this.ymin-size[1], ymax = this.ymax+size[1];
  var zmin = this.zmin-size[2], zmax = this.zmax+size[2];

  vX[0].set(point[0], ymin, zmin);
  vX[1].set(point[0], ymin, zmax);
  vX[2].set(point[0], ymax, zmin);
  vX[3].set(point[0], ymax, zmax);

  vY[0].set(xmin, point[1], zmin);
  vY[1].set(xmin, point[1], zmax);
  vY[2].set(xmax, point[1], zmin);
  vY[3].set(xmax, point[1], zmax);

  vZ[0].set(xmin, ymin, point[2]);
  vZ[1].set(xmin, ymax, point[2]);
  vZ[2].set(xmax, ymin, point[2]);
  vZ[3].set(xmax, ymax, point[2]);

  this.targetPlanes[0].verticesNeedUpdate = true;
  this.targetPlanes[1].verticesNeedUpdate = true;
  this.targetPlanes[2].verticesNeedUpdate = true;
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
    var success = false;
    try {
      parseArray(fr.result);
      success = true;
    } catch(e) {
      console.log("error uploading");
    }
    callback(success);
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

Model.prototype.deleteGeometry = function() {
  for (var i=this.scene.children.length-1; i>=0; i--) {
    var child = this.scene.children[i];
    if (child.name=="model" || child.name=="targetPlane") {
      this.scene.remove(child);
    }
  }

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
