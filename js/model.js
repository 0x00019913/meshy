function Model(scene, camera, container, printout, infoOutput) {
  // internal geometry
  this.triangles = []; // the only array required for rendering and calculations
  this.count = 0;
  //store header to export back out identically
  this.header = null;
  this.isLittleEndian = true;
  this.filename = "";
  // total size of the buffer in bytes
  this.stlSize = 0;

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
  this.scene = scene;
  this.camera = camera;
  this.container = container;
  this.infoOutput = infoOutput;
  this.printout = printout ? printout : console;
  // three orthogonal planes that intersect at the center of the mesh
  this.targetPlanes = null;
  this.showCenterOfMass = false;

  this.measurement = new Measurement(this.scene, this.camera, this.container, this.printout);
  this.measurement.setOutput(this.infoOutput);
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

Model.prototype.getBounds = function() {
  return {
    xmin: this.xmin,
    xmax: this.xmax,
    ymin: this.ymin,
    ymax: this.ymax,
    zmin: this.zmin,
    zmax: this.zmax
  };
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
  if (this.centerOfMass) return this.centerOfMass.x;
  return null;
}
Model.prototype.getCOMy = function() {
  if (this.centerOfMass) return this.centerOfMass.y;
  return null;
}
Model.prototype.getCOMz = function() {
  if (this.centerOfMass) return this.centerOfMass.z;
  return null;
}

Model.prototype.translate = function(axis, amount) {
  this.printout.log("translation by "+amount+" units on "+axis+" axis");
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.translate(axis, amount);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  //transform bounds
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;

  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass[axis] += amount;
    this.positionTargetPlanes(this.centerOfMass.toArray());
  }

  this.measurement.translate(axis, amount);
}

Model.prototype.rotate = function(axis, amount) {
  this.printout.log("rotation by "+amount+" degrees about "+axis+" axis");
  this.resetBounds();
  amount = amount*Math.PI/180.0;
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.rotate(axis, amount);
    this.updateBounds(tri);
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass.applyAxisAngle(axisToVector3Map[axis],amount);
    this.positionTargetPlanes(this.centerOfMass.toArray());
  }

  this.measurement.rotate(axis, amount);
}

Model.prototype.scale = function (axis, amount) {
  this.printout.log("scale by a factor of "+amount+" along "+axis+" axis");
  for (var i=0; i<this.count; i++) {
    var tri = this.triangles[i];
    tri.scale(axis, amount);
    tri.surfaceArea = null;
    tri.volume = null;
  }
  this.plainMesh.geometry.verticesNeedUpdate = true;
  this.plainMesh.geometry.normalsNeedUpdate = true;
  this.plainMesh.geometry.boundingSphere = null;
  this.plainMesh.geometry.boundingBox = null;
  this.surfaceArea = null;
  this.volume = null;
  this[axis+"min"] *= amount;
  this[axis+"max"] *= amount;
  if (this.centerOfMass) {
    // transform center of mass
    this.centerOfMass[axis] *= amount;
    this.positionTargetPlanes(this.centerOfMass.toArray());
  }

  this.measurement.scale(axis, amount);
}

Model.prototype.toggleWireframe = function() {
  this.wireframe = !this.wireframe;
  this.printout.log("wireframe is " + (this.wireframe ? "on" : "off"));
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
  this.centerOfMass = new THREE.Vector3();
  this.centerOfMass.fromArray(center).divideScalar(modelVolume);
}

Model.prototype.toggleCenterOfMass = function() {
  this.calcCenterOfMass();
  this.showCenterOfMass = !this.showCenterOfMass;
  this.printout.log("COM indicator is "+(this.showCenterOfMass ? "on" : "off"));
  var visible = this.showCenterOfMass;
  this.positionTargetPlanes(this.centerOfMass.toArray());
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
    planeMeshes[i].frustumCulled = false;
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
  this.measurement.setScale(this.getMaxSize() * 0.4);

  if (mode == "plain") {
    this.makePlainModel(scene);
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

Model.prototype.makePlainModel = function(scene) {
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

Model.prototype.export = function(format, name) {
  var isLittleEndian = this.isLittleEndian;
  var _this = this;
  var blob;
  var fname;

  if (format=="stl") {
    // this isn't set if we imported a non-STL format
    if (!this.stlSize) this.stlSize = 84 + 50 * this.count;
    var array = new ArrayBuffer(this.stlSize);
    var offset = 0;
    var dv = new DataView(array);
    // I can't figure out a better way of transferring the header bytes to the
    // new array than by using the DataView API and copying them one by one
    if (!this.header) this.header = new ArrayBuffer(80);
    var dvHeader = new DataView(this.header);
    for (offset=0; offset<80; offset++) {
      var ch = dvHeader.getUint8(offset);
      dv.setUint8(offset, ch);
    }

    dv.setUint32(offset, this.count, isLittleEndian);
    offset += 4;
    for (var tri=0; tri<this.count; tri++) {
      var triangle = this.triangles[tri];

      setVector3(dv, offset, triangle.normal, isLittleEndian);
      offset += 12;

      for (var vert=0; vert<3; vert++) {
        setVector3(dv, offset, triangle.vertices[vert], isLittleEndian);
        offset += 12;
      }

      // the "attribute byte count" should be set to 0 according to
      // https://en.wikipedia.org/wiki/STL_(file_format)
      dv.setUint8(offset, 0);
      dv.setUint8(offset+1, 0);

      offset += 2;
    }

    function setVector3(dv, offset, vector, isLittleEndian) {
      dv.setFloat32(offset, vector.x, isLittleEndian);
      dv.setFloat32(offset+4, vector.y, isLittleEndian);
      dv.setFloat32(offset+8, vector.z, isLittleEndian);
    }

    blob = new Blob([dv]);
    fname = name+".stl";
  }
  else if (format=="obj") {
    var fullOut = "";
    var comment = "";
    var verticesOut = "";
    var facesOut = "";

    var vertices = [];
    var arrayBuilder = new Vector3ArrayBuilder(8, this.getBounds(), vertices);

    // go through the faces, simultaneously building vertices
    for (var tri=0; tri<this.count; tri++) {
      var line = "f";
      var triangle = this.triangles[tri];
      for (var vert=0; vert<3; vert++) {
        var vertex = triangle.vertices[vert];
        var idx = arrayBuilder.vIdx(vertex);
        line += " " + (idx+1);
      }
      line += "\n";
      facesOut += line;
    }

    for (var vert=0; vert<vertices.length; vert++) {
      var line = "v";
      var vertex = vertices[vert];
      for (var comp=0; comp<3; comp++) line += " " + vertex.getComponent(comp).toFixed(6);
      line += "\n";
      verticesOut += line;
    }

    // comment and construct the output
    fullOut = "# OBJ exported from Meshy, 0x00019913.github.io/meshy \n";
    fullOut += "# NB: this file only stores faces and vertex positions. \n";
    fullOut += "# vertices: \n";
    fullOut += verticesOut;
    fullOut += "# faces: \n";
    fullOut += facesOut;

    blob = new Blob([fullOut], { type: 'text/plain' });
    fname = name+".obj";
  }
  else {
    this.printout.error("Exporting format '"+format+"' is not supported.");
    return;
  }

  var a = document.createElement("a");
  if (window.navigator.msSaveOrOpenBlob) { // IE :(
    window.navigator.msSaveOrOpenBlob(blob, fname);
  }
  else {
    var url = URL.createObjectURL(blob);
    a.href = url;
    a.download = fname;
    document.body.appendChild(a);
    a.click();
    setTimeout(function() {
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    });
  }
  this.printout.log("Saved file '" + fname + "' as " + format.toUpperCase());
}

Model.prototype.upload = function(file, callback) {
  var fSplit = splitFilename(file.name);
  this.filename = fSplit.name;
  this.format = fSplit.extension;

  var _this = this;

  fr = new FileReader();
  fr.onload = function() {
    var success = false;
    try {
      parseResult(fr.result);
      success = true;
      _this.printout.log("Uploaded file: " + file.name);
    } catch(e) {
      _this.printout.error("Error uploading: " + e);
    }
    callback(success);
  };
  if (this.format=="stl") fr.readAsArrayBuffer(file);
  else if (this.format=="obj") fr.readAsText(file);
  else {
    var error = "Format '"+this.format+"' is not supported.";
    this.printout.error(error);
    callback(false);
  }

  var parseResult = function(result) {
    if (_this.format=="stl") {
      this.stlSize = file.size;
      // mimicking
      // http://tonylukasavage.com/blog/2013/04/10/web-based-stl-viewing-three-dot-js/
      _this.header = result.slice(0, 80); // store header

      var dv = new DataView(result, 80);
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
    else if (_this.format=="obj") {
      _this.count = 0;
      var len = result.length;
      var hasVertNormals = false;
      var vertices = [];
      var vertexNormals = [];
      var i = 0;
      while (i<len) {
        var ch = result[i];
        // if comment, skip to next line
        if (ch=='#') {
          skipToNextLine();
        }
        // if vertex, get vertex; relevant flags are 'v' and 'vn'
        else if (ch=='v') {
          i++;
          ch = result[i];
          // if vertex coords
          if (ch==' ') {
            i++;
            var vertex = getVector3();
            vertices.push(vertex);
          }
          else if (ch=='n') {
            i++;
            var normal = getVector3().normalize();
            vertexNormals.push(normal);
          }
          // line could start with vt or vp; ignore these
          else {
            skipToNextLine();
          }
        }
        else if (ch=='f') {
          i++; i++;
          hasVertNormals = (vertices.length==vertexNormals.length);
          var triangles = getTriangles();
          for (var tri=0; tri<triangles.length; tri++) _this.add(triangles[tri]);
        }
        // ignore other line starting flags
        else {
          skipToNextLine();
        }
      }

      // finds the next instance of char c and puts the index after it;
      // optionally calls a function fn on each character (intended use
      // case is accumulating every character the function sees)
      function skipChars(cs, fn) {
        do {
          if (fn) fn(result[i]);
          i++;
        } while (!charInStr(result[i], cs) && i<len);
        i++;
      }
      function skipToNextLine() { skipChars('\n'); }
      function charInStr(c, s) { return s.indexOf(result[i])>-1; }
      function getVector3() {
        var vector = new THREE.Vector3();
        // read off three numbers
        for (var j=0; j<3; j++) {
          var num = "";
          skipChars(' \n', function(c) { num+=c; })
          vector.setComponent(j, parseFloat(num));
          num = "";
        }
        return vector;
      }
      function getTriangles() {
        var triangles = [];
        // array of 3-element arrays indicating the vertex indices for each tri
        var triIndices = [];

        var idxString = "";
        // take entire line of indices till newline
        skipChars('\n', function(c) { idxString+=c; });
        // split line of vertex indices, trim off any '/'-delimited UVs/normals
        var polyIndices = idxString.split(' ');
        polyIndices = polyIndices.map(function(s) {
          var slashIdx = s.indexOf('/');
          return slashIdx==-1 ? (s-1) : (s.substr(0, slashIdx))-1;
        });

        // if the face is a tri, just one set of 3 indices
        if (polyIndices.length==3) {
          triIndices.push(polyIndices);
        }
        // if a quad, need to triangulate - pick closest corners to make new edge
        else if (polyIndices.length==4) {
          var v = new THREE.Vector3();
          var d02 = v.subVectors(vertices[polyIndices[0]], vertices[polyIndices[2]]).length();
          var d13 = v.subVectors(vertices[polyIndices[1]], vertices[polyIndices[3]]).length();
          if (d02<d13) {
            triIndices.push([polyIndices[0],polyIndices[1],polyIndices[2]]);
            triIndices.push([polyIndices[0],polyIndices[2],polyIndices[3]]);
          }
          else {
            triIndices.push([polyIndices[0],polyIndices[1],polyIndices[3]]);
            triIndices.push([polyIndices[3],polyIndices[1],polyIndices[2]]);
          }
        }
        for (var tri=0; tri<triIndices.length; tri++) {
          triangles.push(new Triangle());
          var triangle = triangles[tri];
          for (var j=0; j<3; j++) {
            triangle.addVertex(vertices[triIndices[tri][j]].clone());
          }

          // average vertex normals (if available) or calculate via x-product
          var normal = new THREE.Vector3();
          if (hasVertNormals) {
            for (var j=0; j<3; j++) normal.add(vertexNormals[triIndices[tri][j]]);
          }
          else {
            var d01 = new THREE.Vector3().subVectors(triangle.vertices[0], triangle.vertices[1]);
            var d02 = new THREE.Vector3().subVectors(triangle.vertices[0], triangle.vertices[2]);
            normal.crossVectors(d01, d02);
          }
          normal.normalize();
          triangle.setNormal(normal);
        }
        return triangles;
      }
    }
  }
}

Model.prototype.dispose = function() {
  this.measurement.deactivate();
  if (!this.scene) return;
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
