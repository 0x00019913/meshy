function Triangle() {
  this.vertices = [];
  this.normal = null;
  this.resetBounds();
  this.count = 0;
}

Triangle.prototype.addVertex = function(vertex) {
  if (this.count>=3) {
    console.log("ERROR: tried to push a fourth vertex onto a triangle");
    return;
  }
  this.vertices.push(vertex);
  this.count++;
  if (this.count==1) {
    this.xmin = vertex.x;
    this.xmax = vertex.x;
    this.ymin = vertex.y;
    this.ymax = vertex.y;
    this.zmin = vertex.z;
    this.zmax = vertex.z;
  }
  else {
    this.updateBounds(vertex);
  }
};

Triangle.prototype.resetBounds = function() {
  this.xmin = -Infinity;
  this.xmax = Infinity;
  this.ymin = -Infinity;
  this.ymax = Infinity;
  this.zmin = -Infinity;
  this.zmax = Infinity;
}
Triangle.prototype.updateBounds = function(vertex) {
  this.xmin = vertex.x<this.xmin ? vertex.x : this.xmin;
  this.xmax = vertex.x>this.xmax ? vertex.x : this.xmax;
  this.ymin = vertex.y<this.ymin ? vertex.y : this.ymin;
  this.ymax = vertex.y>this.ymax ? vertex.y : this.ymax;
  this.zmin = vertex.z<this.zmin ? vertex.z : this.zmin;
  this.zmax = vertex.z>this.zmax ? vertex.z : this.zmax;
}

Triangle.prototype.setNormal = function(normal) {
  this.normal = normal;
};

Triangle.prototype.translate = function(axis, amount) {
  for (var i=0; i<3; i++) {
    var vertex = this.vertices[i];
    vertex[axis] += amount;
  }
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;
}

Triangle.prototype.rotate = function(axis, amount) {
  var axisVector = this.axes[axis];
  var degree = amount*Math.PI/180.0;
  for (var i=0; i<3; i++) {
    var vertex = this.vertices[i];
    vertex.applyAxisAngle(axisVector, degree);
    this.updateBounds(vertex);
  }
}

// for turning "x" etc. into a normalized Vector3 along axis
Triangle.prototype.axes = {
  x: new THREE.Vector3(1,0,0),
  y: new THREE.Vector3(0,1,0),
  z: new THREE.Vector3(0,0,1),
}

Triangle.prototype.yIntersection = function(planePos) {
  var segment = [];
  for (var i=0; i<3; i++) {
    var v1 = this.vertices[i];
    var v2 = this.vertices[(i+1)%3];
    if ((v1.y<planePos && v2.y>planePos) || (v1.y>planePos && v2.y<planePos)) {
      var dy = v2.y-v1.y;
      if (dy==0) return;
      var factor = (planePos-v1.y)/dy;
      var x = v1.x + (v2.x-v1.x)*factor;
      var z = v1.z + (v2.z-v1.z)*factor;
      segment.push(new THREE.Vector3(x,planePos,z));
    }
  }
  if (segment.length!=2) console.log("strange segment length: ", segment);
  return segment;
}
