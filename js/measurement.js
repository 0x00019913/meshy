/* measurement.js
   classes:
    Measurement
   description:
    Represents a manual measurement on the model. Displays markers
    where a user clicks on the model and connects them appropriately.
    Measured values are shown in whatever is set as the output.
    Uses the Pointer class to get the intersection point. Interaction
    occurs by passing the .onClick function to the pointer, which calls
    the .onClick upon clicking the model.
    Turn on with .activate(type) where type is a string (see the
    function for the available types).
    Turn off with .deactivate().
*/

/* Constructor - initialize with a THREE.Scene, a THREE.Camera, an HTML
   element (needed to initialize the Pointer instance) and a Printout
   object to print messages on-screen.
*/
Measurement = function(scene, camera, domElement, printout) {
  this.type = null;
  this.measurementPoints = 0;
  this.pointer = new Pointer(scene, camera, domElement);
  this.printout = printout ? printout : console;
  this.scene = scene;
  this.active = false;

  this.camera = camera;
  this.prevCameraPosition = new THREE.Vector3();

  // ordered from most to least recent (darker is more recent)
  this.markerColors = [0x1adeff, 0x8adeff, 0xeadeff];
  this.connectorColor = 0xffff66;

  var markerGeo = new THREE.SphereGeometry(.03, 8, 6);
  var markerMat = new THREE.MeshStandardMaterial({color: this.markerColors[0]});
  var marker = new THREE.Mesh(markerGeo, markerMat);
  marker.name = "marker";
  marker.visible = false;
  // need at most three markers at the moment
  this.markers = [marker, marker.clone(true), marker.clone(true)];
  this.markers[1].material = markerMat.clone();
  this.markers[2].material = markerMat.clone();
  this.activeMarkers = 0;
  for (var i=0; i<this.markers.length; i++) {
    this.scene.add(this.markers[i]);
  }

  var planeMarkerGeo = new THREE.PlaneGeometry(1,1);
  var planeMarkerMat = new THREE.MeshStandardMaterial({
    color: this.markerColors[0],
    side: THREE.DoubleSide
  });
  planeMarkerMat.transparent = true;
  planeMarkerMat.opacity = 0.5;
  var planeMarker = new THREE.Mesh(planeMarkerGeo, planeMarkerMat);
  planeMarker.name = "marker";
  planeMarker.visible = false;
  // need at most one, but put in an array for consistency
  this.planeMarkers = [planeMarker];
  for (var i=0; i<this.planeMarkers.length; i++) {
    this.scene.add(this.planeMarkers[i]);
  }

  // because .clone() apparently doesn't clone the underlying geometry even
  // when set to recursive, need to make individual connector geo; .clone() was
  // fine for the markers because we only set the position of the mesh, but
  // for the connectors we're setting the underlying geometry
  var lineConnector1Geo = new THREE.Geometry();
  lineConnector1Geo.vertices.push(new THREE.Vector3());
  lineConnector1Geo.vertices.push(new THREE.Vector3());
  var lineConnector2Geo = lineConnector1Geo.clone();
  var lineConnectorMat = new THREE.LineBasicMaterial({
    color: this.connectorColor
  });
  var lineConnector1 = new THREE.LineSegments(lineConnector1Geo, lineConnectorMat);
  var lineConnector2 = new THREE.LineSegments(lineConnector2Geo, lineConnectorMat);
  // need at most two connectors at the moment
  this.lineConnectors = [lineConnector1, lineConnector2];
  for (var i=0; i<this.lineConnectors.length; i++) {
    var connector = this.lineConnectors[i];
    connector.name = "connector";
    connector.visible = false;
    connector.frustumCulled = false;
    this.scene.add(connector);
  }

  var r = 1;
  var circleConnectorSegments = 64;
  var circleConnectorGeo = new THREE.Geometry();
  var circleConnectorMat = new THREE.LineBasicMaterial({
    color: this.connectorColor
  });
  var thetaIncrement = 2 * Math.PI / circleConnectorSegments;
  for (var i=0; i<=circleConnectorSegments; i++) {
    var theta = i * thetaIncrement;
    circleConnectorGeo.vertices.push(new THREE.Vector3(
      r*Math.cos(theta),
      r*Math.sin(theta),
      0));
  }
  var circleConnector = new THREE.Line(circleConnectorGeo, circleConnectorMat);
  // should only need one ever, but putting it in an array for consistency
  this.circleConnectors = [circleConnector];
  for (var i=0; i<this.circleConnectors.length; i++) {
    var connector = this.circleConnectors[i];
    connector.name = "connector";
    connector.visible = false;
    connector.frustumCulled = false;
    this.scene.add(connector);
  }
}

// Turn on a given type of measurement with params (these are required for
// cross-section measurements - need to position the target plane and provide
// a function to calculate the cross-section).
Measurement.prototype.activate = function(type, params) {
  if (this.active) this.deactivate();
  this.active = true;

  if (type=="length") {
    this.measurementPoints = 2;
    this.values = { length: null };
  }
  else if (type=="angle") {
    this.measurementPoints = 3;
    this.values = { angle: null };
  }
  else if (type=="circle") {
    this.measurementPoints = 3;
    this.values = { radius: null, diameter: null, circumference: null, arcLength: null };
  }
  else if (type=="crossSection") {
    if (!params || !params.axis || !params.size || !params.center || !params.fn) {
      this.type = null;
      return;
    }
    this.measurementPoints = 1;
    this.values = { crossSection: null };
    // store size fields for the two axes in the measuring plane
    var nextAxis = cycleAxis(params.axis);
    this.values[nextAxis+"size"] = null;
    nextAxis = cycleAxis(nextAxis);
    this.values[nextAxis+"size"] = null;
    // this.planeParams will henceforth be the source of truth for the plane
    // marker; update it and call this.setPlaneMarker() to position it.
    this.planeParams = params;
    this.setPlaneMarker();
  }
  else {
    this.type = null;

    return;
  }

  this.type = type;

  this.activeMarkers = 0;
  this.markerIdx = 0;
  this.connectorIdx = 0;

  this.pointer.activate();
  // store a place on the pointer's list of callbacks so that we can remove it later
  this.callbackIdx = this.pointer.addClickCallback(this.onClick.bind(this));

  if (this.type) this.printout.log("Measurement activated.");
  return this.type;
}

// deactivate and clear all drawn elements off the screen
Measurement.prototype.deactivate = function() {
  if (!this.active) return;
  this.active = false;
  this.type = null;
  this.values = null;

  for (var i=0; i<this.markers.length; i++) {
    this.markers[i].visible = false;
  }
  for (var i=0; i<this.planeMarkers.length; i++) {
    this.planeMarkers[i].visible = false;
  }
  for (var i=0; i<this.lineConnectors.length; i++) {
    this.lineConnectors[i].visible = false;
  }
  for (var i=0; i<this.circleConnectors.length; i++) {
    this.circleConnectors[i].visible = false;
  }

  this.pointer.removeClickCallback(this.callbackIdx);
  this.pointer.deactivate();

  this.output.hideMeasurementOutput();

  this.printout.log("Measurement deactivated.");
}

// accepts an intersection object returned by THREE.Raycaster
Measurement.prototype.onClick = function(intersection) {
  if (!this.type) return;
  var point = intersection.point;
  if (this.isPlanarMeasurement()) {
    var marker = this.planeMarkers[0];
    marker.position[this.planeParams.axis] = point[this.planeParams.axis];
    marker.visible = true;
    this.activeMarkers = 1;
  }
  else {
    var marker = this.markers[this.markerIdx];
    marker.position.copy(point);
    var prevMarkerIdx = (this.markerIdx-1+this.measurementPoints)%this.measurementPoints;
    var prevprevMarkerIdx =
      (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;

    marker.material.color.set(this.markerColors[0]);
    if (this.measurementPoints>1)
      this.markers[prevMarkerIdx].material.color.set(this.markerColors[1]);
    if (this.measurementPoints>2)
      this.markers[prevprevMarkerIdx].material.color.set(this.markerColors[2]);

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

    this.markerIdx = (this.markerIdx+1)%this.measurementPoints;
  }

  this.calculateMeasurement();
}

// Called when a marker has been placed.
// NB: this.markerIdx is the upcoming marker index, not the one that was
// just placed.
Measurement.prototype.calculateMeasurement = function() {
  var prevMarkerIdx = (this.markerIdx-1+this.measurementPoints)%this.measurementPoints;
  var prevprevMarkerIdx =
    (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;
  if (this.activeMarkers==this.measurementPoints) {
    var v1 = this.markers[prevprevMarkerIdx].position;
    var v2 = this.markers[prevMarkerIdx].position;
    var v3 = this.markers[this.markerIdx].position;
    switch(this.type) {
      case "length":
        this.values.length = v1.clone().sub(v2).length();
        break;
      case "angle":
        var d1 = v1.clone().sub(v2).normalize();
        var d2 = v1.clone().sub(v3).normalize();
        this.values.angle = Math.acos(d1.dot(d2)) * 180 / Math.PI;
        break;
      case "circle":
        var circle = this.calculateCircle(v1, v2, v3);
        if (!circle) this.printout.error("couldn't calculate circle, try again");
        this.setCircleConnector(circle);
        var dc1 = circle.center.clone().sub(v1).normalize();
        var dc2 = circle.center.clone().sub(v2).normalize();
        var dc3 = circle.center.clone().sub(v3).normalize();
        var theta31 = Math.acos(dc3.dot(dc1));
        var theta12 = Math.acos(dc1.dot(dc2));
        this.values.radius = circle.r;
        this.values.diameter = circle.r*2;
        this.values.circumference = circle.r*Math.PI*2;
        this.values.arcLength = circle.r * (theta31+theta12);
        break;
      case "crossSection":
        var pos = this.planeMarkers[0].position[this.planeParams.axis];
        this.planeParams.center[this.planeParams.axis] = pos;
        var crossSectionResult = this.planeParams.fn(this.planeParams.axis, pos);
        // copy values returned by the cross-section function into this.values
        for (var key in crossSectionResult) this.values[key] = crossSectionResult[key];

        break;
    }

    this.values;
    this.showOutput();
  }
}

// If present, return a value that is being measured.
Measurement.prototype.getMeasuredValue = function(type) {
  if (this.values && (type in this.values)) {
    return this.values[type];
  }
  return null;
}

// For scaling to a measurement, get the current measurements, as long as it's
// possible to scale to them (e.g., it doesn't work to scale to an angle).
Measurement.prototype.getScalableMeasurements = function() {
  if (this.values) {
    if (this.type=="angle") return [];
    return Object.keys(this.values);
  }
  return null;
}

// If linear measurement (segments, not circles), can put down connectors
// between consecutive markers.
Measurement.prototype.isLinearMeasurement = function() {
  return this.type=="length" || this.type=="angle";
}
// If planar measurement, put down plane marker instead of normal markers.
Measurement.prototype.isPlanarMeasurement = function() {
  return this.type=="crossSection";
}

// Three vertices in R3 uniquely specify a circle; calculate this circle
// and return its parameters.
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
  // pick two rows (say, x and y) of that equation to solve for k32 =
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
  // This method is somewhat suspect but should work:
  // We have three pairs of equations to solve for the center and therefore
  // three solutions. 0 or 2 of them may be disqualified because the t vectors
  // contain elements equal to 0. If only one center is calculated, that's the
  // center. If two (shouldn't happen) or three, take the answer to be the mean.
  // Picking a random one doesn't make sense, and, as they should be almost
  // identical, the mean should be very close to the right answer (and, given
  // many measurements, should equal the right answer on average).
  if (centers.length==0) this.printout.error("couldn't calculate center, try again");
  else if (centers.length==1) center = centers[0];
  else if (centers.length==2) center = centers[0].add(centers[1]).multiplyScalar(1/2);
  else if (centers.length==3) center =
    centers[0].add(centers[1]).add(centers[2]).multiplyScalar(1/3);
  if (!center) return;
  var r = v1.clone().sub(center).length();

  return { center: center, r: r, n: n};
}

// Put down the circle connector with the given parameters.
Measurement.prototype.setCircleConnector = function(circle) {
  var connector = this.circleConnectors[0];
  connector.position.copy(circle.center);
  connector.scale.set(circle.r, circle.r, circle.r);
  connector.lookAt(circle.center.clone().add(circle.n));
  connector.visible = true;
}

Measurement.prototype.setPlaneMarker = function() {
  var marker = this.planeMarkers[0];
  marker.position.copy(getZeroVector());
  marker.lookAt(axisToVector3(this.planeParams.axis));
  marker.position.copy(this.planeParams.center);
  var size = this.planeParams.size.clone();
  // want the marker to extrude past the bounds of the model
  size.multiplyScalar(1.2);
  // Not obvious and far messier than I'd like, but can't think of a better way:
  // The .scale attribute scales the plane in its object space. The plane starts
  // out with its geometry in the xy plane and with z its normal. Having
  // oriented the model in world space with .lookAt, need to rotate the size
  // vector into the same orientation and *then* use it to scale. (But, if it's
  // already aligned with z, don't need to do anything.)
  if (this.planeParams.axis != "z") {
    var axisVector = axisToVector3(this.planeParams.axis);
    var rotationAngle = axisToVector3("z").clone().cross(axisVector);
    // one dimension of the scale goes negative after rotation without this
    size.y *= -1;
    size.applyAxisAngle(rotationAngle, Math.PI/2);
  }
  marker.scale.copy(size);
}

// Set the size of the markers and pointer.
Measurement.prototype.rescale = function() {
  if (!this.active) return;

  var cameraPos = this.camera.position;
  // if camera has moved, update; else, do nothing
  if (this.prevCameraPosition.distanceTo(cameraPos) > 0.0001) {
    this.prevCameraPosition.copy(cameraPos);

    this.pointer.rescale();
    for (var i=0; i<this.markers.length; i++) {
      var marker = this.markers[i];
      var scale = marker.position.distanceTo(cameraPos)*0.1;
      marker.scale.set(scale, scale, scale);
    }
  }
}

// Translate the markers and the connectors.
Measurement.prototype.translate = function(amount) {
  if (!this.active) return;

  // if plane measurement, just translate plane
  if (this.isPlanarMeasurement()) {
    for (var i=0; i<this.planeMarkers.length; i++) {
      this.planeParams.center.add(amount);
      this.setPlaneMarker();
    }
  }
  // else, need to translate markers and connectors
  else {
    // translate markers
    for (var i=0; i<this.markers.length; i++) {
      var marker = this.markers[i];
      if (marker.visible) marker.position.add(amount);
    }

    // translate line conectors if linear measurement
    if (this.isLinearMeasurement()) {
      for (var i=0; i<this.lineConnectors.length; i++) {
        var connector = this.lineConnectors[i];
        if (connector.visible) {
          connector.geometry.vertices[0].add(amount);
          connector.geometry.vertices[1].add(amount);
          connector.geometry.verticesNeedUpdate = true;
        }
      }
    }
    // else, translate circle connectors
    else {
      for (var i=0; i<this.circleConnectors.length; i++) {
        var connector = this.circleConnectors[i];
        if (connector.visible) connector.position.add(amount);
      }
    }
  }
}

// Rotate the markers and the connectors.
// The size argument is necessary for resizing the plane marker, which is not
// rotationally symmetric.
Measurement.prototype.rotate = function(axis, amount, size) {
  if (!this.active) return;

  var axisVector = axisToVector3(axis);
  if (this.isPlanarMeasurement()) {
    // If rotating in the same plane as the planar measurement, can just rotate
    // the plane marker and everything's good.
    if (this.planeParams && this.planeParams.axis==axis) {
      this.planeParams.size = size;
      this.planeParams.center.applyAxisAngle(axisVector, amount);
      this.setPlaneMarker();
    }
    // But, if rotating on a different axis, the plane would be rotated to
    // have some off-axis normal, so we just deactivate in that case.
    else {
      this.deactivate();
    }
  }
  else {
    // rotate markers
    for (var i=0; i<this.markers.length; i++) {
      var marker = this.markers[i];
      if (marker.visible) marker.position.applyAxisAngle(axisVector, amount);
    }

    // rotate line conectors if linear measurement
    if (this.isLinearMeasurement()) {
      for (var i=0; i<this.lineConnectors.length; i++) {
        var connector = this.lineConnectors[i];
        if (connector.visible) {
          connector.geometry.vertices[0].applyAxisAngle(axisVector, amount);
          connector.geometry.vertices[1].applyAxisAngle(axisVector, amount);
          connector.geometry.verticesNeedUpdate = true;
        }
      }
    }
    // else, rotate circle connectors
    else {
      for (var i=0; i<this.circleConnectors.length; i++) {
        var connector = this.circleConnectors[i];
        if (connector.visible) {
          // rotate circle's position
          connector.position.applyAxisAngle(axisVector, amount);
          // can't use .rotateOnAxis b/c that rotates the circle in object space,
          // where its axes are arbitrarily oriented; need to get its up direction
          // in world space, rotate that appropriately, then .lookat position+that
          var worldDir = connector.getWorldDirection();
          worldDir.applyAxisAngle(axisVector, amount);
          connector.lookAt(connector.position.clone().add(worldDir));
        }
      }
    }
  }
}

// Scale the markers and recalculate the connectors.
Measurement.prototype.scale = function(amount) {
  if (!this.active) return;

  if (this.isPlanarMeasurement()) {
    this.planeParams.center.multiply(amount);
    this.planeParams.size.multiply(vector3Abs(amount));
    this.setPlaneMarker();
  }
  else {
    // scale markers
    for (var i=0; i<this.markers.length; i++) {
      var marker = this.markers[i];
      if (marker.visible) marker.position.multiply(amount);
    }

    // scale line conectors if linear measurement
    if (this.isLinearMeasurement()) {
      for (var i=0; i<this.lineConnectors.length; i++) {
        var connector = this.lineConnectors[i];
        if (connector.visible) {
          connector.geometry.vertices[0].multiply(amount);
          connector.geometry.vertices[1].multiply(amount);
          connector.geometry.verticesNeedUpdate = true;
        }
      }
    }
  }
  // recalculate all measurements, including placing circle connector if needed
  this.calculateMeasurement();
}

// Use to set the measurement output.
Measurement.prototype.setOutput = function(output) {
  this.output = output;
}

// Print a measurement to the output.
Measurement.prototype.showOutput = function() {
  if (this.output) {
    this.output.showMeasurement(this.values);
  }
  else {
    this.printout.log(this.values);
  }
}

Measurement.prototype.dispose = function() {
  removeMeshByName(this.scene, "marker");
  removeMeshByName(this.scene, "connector");

  this.pointer.dispose();
}
