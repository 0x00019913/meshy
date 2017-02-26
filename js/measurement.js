Measurement = function(scene, camera, domElement, printout) {
  this.type = null;
  this.measurementPoints = 0;
  this.pointer = new Pointer(scene, camera, domElement);
  this.printout = printout ? printout : console;
  this.scene = scene;
  this.active = false;

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

Measurement.prototype.activate = function(type) {
  if (this.active) this.deactivate();
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

  this.output.hideMeasurementOutput();
}

// accepts an intersection object returned by THREE.Raycaster
Measurement.prototype.onClick = function(intersection) {
  var point = intersection.point;
  var marker = this.markers[this.markerIdx];
  marker.position.copy(point);
  var prevMarkerIdx = (this.markerIdx-1+this.measurementPoints)%this.measurementPoints;
  var prevprevMarkerIdx =
    (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;

  // can reconsolidate but doesn't seem necessary
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

  this.calculateMeasurement();
}

// this.markerIdx is the upcoming marker index, not the one that was just placed
Measurement.prototype.calculateMeasurement = function() {
  var prevMarkerIdx = (this.markerIdx-1+this.measurementPoints)%this.measurementPoints;
  var prevprevMarkerIdx =
    (prevMarkerIdx-1+this.measurementPoints)%this.measurementPoints;
  var result = 0;
  if (this.activeMarkers==this.measurementPoints) {
    var v1 = this.markers[prevprevMarkerIdx].position;
    var v2 = this.markers[prevMarkerIdx].position;
    var v3 = this.markers[this.markerIdx].position;
    switch(this.type) {
      case "segmentLength":
        result = { length: new THREE.Vector3().subVectors(v1,v2).length() };
        break;
      case "angle":
        var d1 = v1.clone().sub(v2).normalize();
        var d2 = v1.clone().sub(v3).normalize();
        result = { angle: Math.acos(d1.dot(d2)) * 180 / Math.PI };
        break;
      case "radius":
        var circle = this.calculateCircle(v1, v2, v3);
        if (!circle) this.printout.error("couldn't calculate circle, try again");
        this.setCircleConnector(circle);
        result = { radius: circle.r, circumference: circle.r*Math.PI*2 };
        break;
      case "arcLength":
        var circle = this.calculateCircle(v1, v2, v3);
        if (!circle) this.printout.log("couldn't calculate circle, try again");
        this.setCircleConnector(circle);
        var dc1 = circle.center.clone().sub(v1).normalize();
        var dc2 = circle.center.clone().sub(v2).normalize();
        var dc3 = circle.center.clone().sub(v3).normalize();
        var theta31 = Math.acos(dc3.dot(dc1));
        var theta12 = Math.acos(dc1.dot(dc2));
        var result = { arcLength: circle.r * (theta31+theta12) };
        break;
    }

    this.showOutput(result);
  }
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

Measurement.prototype.setCircleConnector = function(circle) {
  var connector = this.circleConnectors[0];
  connector.position.copy(circle.center);
  connector.scale.set(circle.r, circle.r, circle.r);
  connector.lookAt(circle.center.clone().add(circle.n));
  connector.visible = true;
}

Measurement.prototype.setScale = function(scale) {
  this.pointer.setScale(scale);
  for (var i=0; i<this.markers.length; i++) {
    this.markers[i].scale.set(scale, scale, scale);
  }
}

Measurement.prototype.translate = function(axis, amount) {
  if (!this.active) return;

  // translate markers
  for (var i=0; i<this.markers.length; i++) {
    var marker = this.markers[i];
    if (marker.visible) marker.position[axis] += amount;
  }

  // translate line conectors if linear measurement
  if (this.isLinearMeasurement()) {
    for (var i=0; i<this.lineConnectors.length; i++) {
      var connector = this.lineConnectors[i];
      if (connector.visible) {
        connector.geometry.vertices[0][axis] += amount;
        connector.geometry.vertices[1][axis] += amount;
        connector.geometry.verticesNeedUpdate = true;
      }
    }
  }
  // else, translate circle connectors
  else {
    for (var i=0; i<this.circleConnectors.length; i++) {
      var connector = this.circleConnectors[i];
      if (connector.visible) connector.position[axis] += amount;
    }
  }
}

Measurement.prototype.rotate = function(axis, amount) {
  if (!this.active) return;

  // rotate markers
  var axisVector = axisToVector3Map[axis];
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

Measurement.prototype.scale = function(axis, amount) {
  if (!this.active) return;

  // scale markers
  var axisVector = axisToVector3Map[axis];
  for (var i=0; i<this.markers.length; i++) {
    var marker = this.markers[i];
    if (marker.visible) marker.position[axis] *= amount;
  }

  // scale line conectors if linear measurement
  if (this.isLinearMeasurement()) {
    for (var i=0; i<this.lineConnectors.length; i++) {
      var connector = this.lineConnectors[i];
      if (connector.visible) {
        connector.geometry.vertices[0][axis] *= amount;
        connector.geometry.vertices[1][axis] *= amount;
        connector.geometry.verticesNeedUpdate = true;
      }
    }
  }
  // don't need to rotate circle connectors because scaling requires recalculating it
  this.calculateMeasurement();
}

Measurement.prototype.setOutput = function(output) {
  this.output = output;
}

Measurement.prototype.showOutput = function(measurement) {
  if (this.output) {
    this.output.showMeasurement(measurement);
  }
  else {
    this.printout.log(measurement);
  }
}
