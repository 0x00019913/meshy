Measurement = function(scene, camera, domElement) {
  this.type = null;
  this.measurementPoints = 0;
  this.pointer = new Pointer(scene, camera, domElement);
  this.scene = scene;
  this.active = false;

  this.markerColor = 0x4adeff;
  this.connectorColor = 0xffff00;

  var markerGeo = new THREE.SphereGeometry(.03, 8, 6);
  var markerMat = new THREE.MeshStandardMaterial({color: this.markerColor});
  var marker = new THREE.Mesh(markerGeo, markerMat);
  marker.name = "marker";
  marker.visible = false;
  // need at most three markers at the moment
  this.markers = [marker, marker.clone(true), marker.clone(true)];
  this.activeMarkers = 0;
  for (var i=0; i<this.markers.length; i++) {
    this.scene.add(this.markers[i]);
  }

  // because .clone() apparently doesn't clone the underlying geometry even
  // when set to recursive, need to make individual connector geo; .clone() was
  // fine for the markers because we only set the position of the mesh, but
  // for the connectors we're setting the underlying geometry
  var lineConnector1Geo = new THREE.Geometry();
  lineConnector1Geo.vertices.push(new THREE.Vector3());
  lineConnector1Geo.vertices.push(new THREE.Vector3());
  var lineConnector2Geo = lineConnector1Geo.clone();
  var lineConnectorMat = new THREE.LineBasicMaterial({color: this.connectorColor});
  var lineConnector1 = new THREE.LineSegments(lineConnector1Geo, lineConnectorMat);
  var lineConnector2 = new THREE.LineSegments(lineConnector2Geo, lineConnectorMat);
  lineConnector1.name = "connector";
  lineConnector2.name = "connector"
  lineConnector1.visible = false;
  lineConnector2.visible = false;
  // need at most two connectors at the moment
  this.lineConnectors = [lineConnector1, lineConnector2];
  for (var i=0; i<this.lineConnectors.length; i++) {
    this.scene.add(this.lineConnectors[i]);
  }

  var r = 1;
  var circleConnectorSegments = 64;
  var circleConnectorGeo = new THREE.Geometry();
  var circleConnectorMat = new THREE.LineBasicMaterial({color: this.connectorColor});
  var thetaIncrement = 2 * Math.PI / circleConnectorSegments;
  for (var i=0; i<=circleConnectorSegments; i++) {
    var theta = i * thetaIncrement;
    circleConnectorGeo.vertices.push(new THREE.Vector3(
      r*Math.cos(theta),
      r*Math.sin(theta),
      0));
  }
  var circleConnector = new THREE.Line(circleConnectorGeo, circleConnectorMat);
  circleConnector.name = "connector";
  circleConnector.visible = false;
  // should only need one ever, but putting it in an array for consistency
  this.circleConnectors = [circleConnector];

  for (var i=0; i<this.circleConnectors.length; i++) {
    this.scene.add(this.circleConnectors[i]);
  }
}

Measurement.prototype.activate = function(type) {
  console.log("activate");
  if (this.active) return;
  this.active = true;

  if (type=="segmentLength") this.measurementPoints = 2;
  else if (type=="angle") this.measurementPoints = 3;
  else if (type=="radius") this.measurementPoints = 3;
  else if (type=="arcLength") this.measurementPoints = 3;
  else {
    this.type = null;
    return;
  }

  this.type = type;

  this.activeMarkers = 0;
  this.markerIdx = 0;
  this.connectorIdx = 0;

  this.pointer.active = true;
  // store a place on the pointer's list of callbacks so that we can remove it later
  this.callbackIdx = this.pointer.addClickCallback(this.onClick.bind(this));
}

Measurement.prototype.deactivate = function() {
  if (!this.active) return;
  this.active = false;
  this.type = null;

  for (var i=0; i<this.markers.length; i++) {
    this.markers[i].visible = false;
  }
  for (var i=0; i<this.lineConnectors.length; i++) {
    this.lineConnectors[i].visible = false;
  }
  for (var i=0; i<this.circleConnectors.length; i++) {
    this.circleConnectors[i].visible = false;
  }

  this.pointer.removeClickCallback(this.callbackIdx);
  this.pointer.active = false;
}

// accepts an intersection object returned by THREE.Raycaster
Measurement.prototype.onClick = function(intersection) {
  var point = intersection.point;
  var marker = this.markers[this.markerIdx];
  marker.position.copy(point);
  var prevMarkerIdx = (this.markerIdx-1+this.measurementPoints)%this.measurementPoints;

  if (this.activeMarkers<this.measurementPoints) {
    this.activeMarkers++;
    marker.visible = true;
  }

  // can connect consecutive markers with linear connectors if the
  // measurement is not circular
  if (this.isLinearMeasurement()) {
    if (this.activeMarkers>1) {
      var connector = this.lineConnectors[this.connectorIdx];
      var markerPrev = this.markers[prevMarkerIdx];

      connector.visible = true;
      connector.geometry.vertices[0].copy(markerPrev.position);
      connector.geometry.vertices[1].copy(marker.position);
      connector.geometry.verticesNeedUpdate = true;

      this.connectorIdx = (this.connectorIdx+1)%(this.measurementPoints-1);
    }
  }

  var result = 0;
  if (this.activeMarkers==this.measurementPoints) {
    switch(this.type) {
      case "segmentLength":
        var v1 = this.markers[prevMarkerIdx].position;
        var v2 = this.markers[this.markerIdx].position;
        result = new THREE.Vector3().subVectors(v1,v2).length();
        break;
      case "angle":
        var prevprevMarkerIdx =
          (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;
        var v1 = this.markers[prevprevMarkerIdx].position;
        var v2 = this.markers[prevMarkerIdx].position;
        var v3 = this.markers[this.markerIdx].position;
        var d1 = v2.clone().sub(v1).normalize();
        var d2 = v2.clone().sub(v3).normalize();
        result = Math.acos(d1.dot(d2)) * 180 / Math.PI;
        break;
      case "radius":
        var prevprevMarkerIdx =
          (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;
        var v1 = this.markers[prevprevMarkerIdx].position;
        var v2 = this.markers[prevMarkerIdx].position;
        var v3 = this.markers[this.markerIdx].position;
        var circle = this.calculateCircle(v1, v2, v3);
        if (!circle) console.log("Error: couldn't calculate circle.");
        console.log(circle.r);
        var connector = this.circleConnectors[0];
        connector.position.copy(circle.center);
        connector.scale.set(circle.r, circle.r, circle.r);
        connector.lookAt(circle.center.clone().add(circle.n));
        connector.visible = true;
        break;
    }
  }

  this.markerIdx = (this.markerIdx+1)%this.measurementPoints;
}

Measurement.prototype.isLinearMeasurement = function() {
  return this.type=="segmentLength" || this.type=="angle";
}

Measurement.prototype.calculateCircle = function(v1, v2, v3) {
  // vectors from v1/2 to v2: d32 = v3-v2, d12 = v1-v2
  var d32 = v3.clone().sub(v2);
  var d12 = v1.clone().sub(v2);
  // normal: n = (v3-v2) x (v1-v2)
  var n = new THREE.Vector3().crossVectors(d32, d12).normalize();
  // points bisecting v1-v2 and v3-v2 segments
  var b12 = v1.clone().add(v2).multiplyScalar(1/2);
  var b32 = v3.clone().add(v2).multiplyScalar(1/2);
  // vector tangent to line thru center at b12: t12 = n cross(v1-v2)
  var t12 = n.clone().cross(d12);
  var t32 = n.clone().cross(d32);
  // center: c = b32 + k32*t32, c = b12 + k12*t12 for some variables k
  // so (b32-b12) = k12*t12 - k32*t32
  // pick x and y rows of that equation to solve for k32 =
  //  ((b32.x-b12.x)/t12.x-(b32.y-b12.y)/t12.y) / (t32.x/t12.x-t32.y/t12.y)
  // caution: need to test if any components of t12 are 0 b/c of division
  centers = [];
  if (t12.x!=0 && t12.y!=0) {
    var k32xy =
      (-(b32.x-b12.x)/t12.x+(b32.y-b12.y)/t12.y) / (t32.x/t12.x-t32.y/t12.y);
    var cxy = b32.clone().add(t32.clone().multiplyScalar(k32xy));
    centers.push(cxy);
  }
  if (t12.z!=0 && t12.y!=0) {
    var k32zy =
      (-(b32.z-b12.z)/t12.z+(b32.y-b12.y)/t12.y) / (t32.z/t12.z-t32.y/t12.y);
    var czy = b32.clone().add(t32.clone().multiplyScalar(k32zy));
    centers.push(czy);
  }
  if (t12.x!=0 && t12.z!=0) {
    var k32xz =
      (-(b32.x-b12.x)/t12.x+(b32.z-b12.z)/t12.z) / (t32.x/t12.x-t32.z/t12.z);
    var cxz = b32.clone().add(t32.clone().multiplyScalar(k32xz));
    centers.push(cxz);
  }

  var center = null;
  if (centers.length==0) console.log("Error: couldn't calculate center.");
  else if (centers.length==1) center = centers[0];
  else if (centers.length==2) center = centers[0].add(centers[1]).multiplyScalar(1/2);
  else if (centers.length==3) center =
    centers[0].add(centers[1]).add(centers[2]).multiplyScalar(1/3);
  if (!center) return;
  var r = v1.clone().sub(center).length();

  return { center: center, r: r, n: n};
}

Measurement.prototype.setScale = function(scale) {
  this.pointer.setScale(scale);
  for (var i=0; i<this.markers.length; i++) {
    this.markers[i].scale.set(scale, scale, scale);
  }
}
