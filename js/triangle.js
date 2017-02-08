function Triangle() {
  this.vertices = [];
  this.normal = null;
  this.xmin = null;
  this.xmax = null;
  this.ymin = null;
  this.ymax = null;
  this.zmin = null;
  this.zmax = null;
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
    vertex.setX(0);
    //vertex["set"+axis.toUpperCase()](vertex[axis]+amount);
  }
  this[axis+"min"] += amount;
  this[axis+"max"] += amount;
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
