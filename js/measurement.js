Measurement = function(scene, camera, domElement) {
  this.type = null;
  this.measurementPoints = 0;
  this.pointer = new Pointer(scene, camera, domElement);
  this.scene = scene;
  this.active = false;

  this.markerColor = 0x4adeff;
  this.connectorColor = 0x0;

  var markerGeo = new THREE.SphereGeometry(.03, 8, 6);
  var markerMat = new THREE.MeshStandardMaterial({color: this.markerColor});
  var marker = new THREE.Mesh(markerGeo, markerMat);
  marker.name = "marker";
  marker.visible = false;
  // need at most three markers at the moment
  this.markers = [marker, marker.clone(true), marker.clone(true)];
  this.activeMarkers = [];
  for (var i=0; i<this.markers.length; i++) this.scene.add(this.markers[i]);

  var lineConnectorGeo = new THREE.Geometry();
  lineConnectorGeo.vertices.push(new THREE.Vector3());
  lineConnectorGeo.vertices.push(new THREE.Vector3());
  var lineConnectorMat = new THREE.LineBasicMaterial({color: this.connectorColor});
  var lineConnector = new THREE.LineSegments(lineConnectorGeo, lineConnectorMat);
  lineConnector.name = "connector";
  lineConnector.visible = false;
  // need at most two connectors at the moment
  this.lineConnectors = [lineConnector, lineConnector.clone(true)];
  for (var i=0; i<this.lineConnectors.length; i++) {
    this.scene.add(this.lineConnectors[i]);
  }

  var r = 0.05;
  var circleConnectorSegments = 32;
  var circleConnectorGeo = new THREE.Geometry();
  var circleConnectorMat = new THREE.LineBasicMaterial({color: this.connectorColor});
  var thetaIncrement = 2 * Math.PI / circleConnectorSegments;
  for (var i=0; i<=circleConnectorSegments; i++) {
    var theta = i * thetaIncrement;
    circleConnectorGeo.vertices.push(new THREE.Vector3(r*Math.cos(theta), r*Math.sin(theta), 0));
  }
  var circleConnector = new THREE.Line(circleConnectorGeo, circleConnectorMat);
  circleConnector.name = "connector";
  circleConnector.visible = false;
  // should only need one ever, but putting it in an array for consistency
  this.circleConnectors = [circleConnector];

  this.activeConnectors = [];

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

  this.activeMarkers = [];
  this.activeConnectors = [];
  this.markerIdx = 0;

  this.pointer.active = true;
  // store a place on the pointer's list of callbacks so that we can remove it later
  this.callbackIdx = this.pointer.addClickCallback(this.onClick.bind(this));
}

Measurement.prototype.deactivate = function() {
  if (!this.active) return;
  this.active = false;
  this.type = null;

  for (var i=0; i<this.activeMarkers.length; i++) {
    this.activeMarkers[i].visible = false;
  }
  for (var i=0; i<this.activeConnectors.length; i++) {
    this.activeConnectors[i].visible = false;
  }

  this.pointer.removeClickCallback(this.callbackIdx);
  this.pointer.active = false;
}

// accepts an intersection object returned by THREE.Raycaster
Measurement.prototype.onClick = function(intersection) {
  var point = intersection.point;
  var marker = this.markers[this.markerIdx];
  marker.position.copy(point);
  if (this.activeMarkers.length<this.measurementPoints) {
    marker.visible = true;
    this.activeMarkers[this.markerIdx] = marker;
  }
  else {
    // todo; connect and measure here
  }
  this.markerIdx = (this.markerIdx+1)%this.measurementPoints;
}

Measurement.prototype.setScale = function(scale) {
  this.pointer.setScale(scale);
  for (var i=0; i<this.markers.length; i++) {
    this.markers[i].scale.set(scale, scale, scale);
  }
}
