var Measurement = (function() {

  var Vector3 = THREE.Vector3;
  var Plane = THREE.Plane;

  function axisToVector3(axis) {
    var v = new Vector3();
    v[axis] = 1;
    return v;
  }

  // push b's terms onto a without using concat
  function arrayAppend(target, source) {
    var sourceLength = source.length;

    for (var i = 0; i < sourceLength; i++) target.push(source[i]);
  }

  // Measurement constructor

  function Measurement(pointer, scene) {
    this.pointer = pointer;
    this.scene = scene;

    this.active = false;
    this.type = Measurement.Types.none;
    this.params = null;

    this.markerFactory = new MarkerFactory();
    this.connectorFactory = new ConnectorFactory();

    this.markers = [];
    this.connectors = [];

    this.result = this.makeResult(false)

    // index of the marker due to be placed next
    this.midx = 0;
    // number of active markers
    this.mactive = 0;
    // total number of markers and connectors
    this.mnum = 0;
    this.cnum = 0;

    // type of markers and connectors
    this.mtype = Marker.Types.none;
    this.ctype = Connector.Types.none;

    this.pointerCallbackIdx = -1;

    // optionally called when a result has been calculated
    this.onResultChange = null;
  }

  Measurement.Types = {
    none: "none",
    length: "length",
    angle: "angle",
    circle: "circle",
    crossSection: "crossSection",
    orientedCrossSection: "orientedCrossSection"
  };

  Object.assign(Measurement.prototype, {

    constructor: Measurement,

    activate: function(type, params) {
      this.active = true;

      this.type = type;
      this.params = params || {};

      this.markers.length = 0;
      this.connectors.length = 0;

      this.midx = 0;
      this.mnum = 0;
      this.cnum = 0;
      this.mactive = 0;

      this.mtype = Marker.Types.none;
      this.ctype = Connector.Types.none;

      this.result = this.makeResult(false);

      var mparams = {};
      var cparams = {};

      var mfactory = this.markerFactory;
      var cfactory = this.connectorFactory;
      var scene = this.scene;

      this.params.mesh = null;

      // set the correct number and types of markers and connectors
      if (type === Measurement.Types.length) {
        this.mnum = 2; // 2 point markers
        this.cnum = 1; // 1 line connector
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.line;

        this.params.p0 = null;
        this.params.p1 = null;
      }
      else if (type === Measurement.Types.angle) {
        this.mnum = 3; // 3 point markers
        this.cnum = 2; // 2 line connectors
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.line;

        this.params.p0 = null;
        this.params.p1 = null;
        this.params.p2 = null;
      }
      else if (type === Measurement.Types.circle) {
        this.mnum = 3; // 3 point markers
        this.cnum = 1; // 1 circle connector
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.circle;

        this.params.center = null;
        this.params.normal = null;
        this.params.radius = null;
      }
      else if (type === Measurement.Types.crossSection) {
        this.mnum = 1; // 1 plane marker
        this.cnum = 1; // 1 contour connector
        this.mtype = Marker.Types.plane;
        this.ctype = Connector.Types.contour;
        this.params.axis = this.params.axis || "z";

        // params of the axis-oriented plane denoting the cross-section
        this.params.normal = this.params.normal || axisToVector3(this.params.axis);
        this.params.point = null;

        // use this normal to create the plane marker
        mparams.axis = this.params.axis;
        mparams.normal = this.params.normal;
      }
      else if (type === Measurement.Types.orientedCrossSection) {
        this.mnum = 3; // 3 point markers
        this.cnum = 1; // 1 contour connector
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.contour;

        // params of the circle denoting the cross-section
        this.params.normal = null;
        this.params.center = null;
        this.params.radius = null;
      }
      else return;

      // generate the markers and connectors, and add them to the scene
      for (var m = 0; m < this.mnum; m++) {
        var marker = mfactory.make(this.mtype, mparams);
        this.markers.push(marker);
        marker.addToScene(scene);
      }
      for (var c = 0; c < this.cnum; c++) {
        var connector = cfactory.make(this.ctype, cparams);
        this.connectors.push(connector);
        connector.addToScene(scene);
      }

      this.pointerCallbackIdx = this.pointer.addClickCallback(this.placeMarker.bind(this));
      this.pointer.setCursor(0);
      this.pointer.activate();
    },

    placeMarker: function(intersection) {
      var point = intersection.point;
      var mesh = intersection.object;

      this.params.mesh = mesh;

      this.mactive = Math.min(this.mnum, this.mactive + 1);

      var marker = this.markers[this.midx];

      this.setMarkerColors();
      this.setConnectorColors();

      // position marker to use it for calculation
      marker.setPosition(point);
      marker.activate();
      // advance current marker idx; now, the most recently placed marker is at
      // index this.midx - 1
      this.midx = (this.midx + 1) % this.mnum;

      this.setParams();

      this.calculateResult();

      if (this.onResultChange) {
        this.onResultChange(this.result);
      }

      // if plane, just position the marker given the measurement result
      if (this.isPlanar()) {
        this.positionPlaneMarker();
      }

      // position the connectors
      this.positionConnectors();
    },

    setParams: function() {
      var idx0 = (this.midx) % this.mnum;
      var idx1 = (this.midx + 1) % this.mnum;
      var idx2 = (this.midx + 2) % this.mnum;

      if (this.type === Measurement.Types.length) {
        this.params.p0 = (this.mactive > 0) ? this.markers[idx0].getPosition() : null;
        this.params.p1 = (this.mactive > 1) ? this.markers[idx1].getPosition() : null;
      }
      else if (
        this.type === Measurement.Types.angle
        || this.type === Measurement.Types.circle
        || this.type === Measurement.Types.orientedCrossSection) {
        this.params.p0 = (this.mactive > 0) ? this.markers[idx0].getPosition() : null;
        this.params.p1 = (this.mactive > 1) ? this.markers[idx1].getPosition() : null;
        this.params.p2 = (this.mactive > 2) ? this.markers[idx2].getPosition() : null;
      }
      else if (this.type === Measurement.Types.crossSection) {
        this.params.point = (this.mactive > 0) ? this.markers[idx0].getPosition() : null;
      }
    },

    calculateResult: function() {
      // if not enough markers, do nothing
      if (this.mactive < this.mnum) return;

      this.result = this.makeResult(false);

      if (this.type === Measurement.Types.length) {
        var p0 = this.params.p0;
        var p1 = this.params.p1;

        if (p0 === null || p1 === null) return;

        this.result.length = p0.distanceTo(p1);
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.angle) {
        var p0 = this.params.p0;
        var p1 = this.params.p1;
        var p2 = this.params.p2;

        if (p0 === null || p1 === null || p2 === null) return;

        var d10 = new Vector3().subVectors(p0, p1).normalize();
        var d12 = new Vector3().subVectors(p2, p1).normalize();
        var dot = d10.dot(d12);

        this.result.angle = acos(dot);
        this.result.angleDegrees = this.result.angle * 180.0 / Math.PI;
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.circle) {
        var p0 = this.params.p0;
        var p1 = this.params.p1;
        var p2 = this.params.p2;

        var circle = (p0 && p1 && p2) ? Calculate.circleFromThreePoints(p0, p1, p2) : null;

        if (!circle) return;

        var center = circle.center;
        var normal = circle.normal;
        var radius = circle.radius;

        this.result.radius = radius;
        this.result.diameter = radius * 2;
        this.result.circumference = radius * 2 * Math.PI;
        this.result.area = radius * radius * Math.PI;
        this.result.center = center;
        this.result.normal = normal;
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.crossSection) {
        var normal = this.params.normal;
        var point = this.params.point;

        if (normal === null || point === null) return;

        var mesh = this.params.mesh;
        var plane = new Plane();
        plane.setFromNormalAndCoplanarPoint(normal, point);

        var crossSectionResult = Calculate.crossSection(plane, mesh);

        var segments = [];
        var area = 0;
        var length = 0;
        var boundingBox = new THREE.Box3();

        // accumulate the result
        for (var s = 0, ls = crossSectionResult.length; s < ls; s++) {
          var polygonResult = crossSectionResult[s];

          arrayAppend(segments, polygonResult.segments);
          area += polygonResult.area;
          length += polygonResult.length;
          boundingBox.expandByPoint(polygonResult.boundingBox.min);
          boundingBox.expandByPoint(polygonResult.boundingBox.max);
        }

        this.connectors[0].setFromSegments(segments);

        this.result.area = area;
        this.result.min = boundingBox.min;
        this.result.max = boundingBox.max;
        this.result.length = length;
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.orientedCrossSection) {
        var p0 = this.params.p0;
        var p1 = this.params.p1;
        var p2 = this.params.p2;

        var circle = (p0 && p1 && p2) ? Calculate.circleFromThreePoints(p0, p1, p2) : null;

        if (!circle) return;

        var center = circle.center;
        var normal = circle.normal;

        var mesh = this.params.mesh;
        var plane = new Plane();
        plane.setFromNormalAndCoplanarPoint(normal, center);

        var crossSectionResult = Calculate.crossSection(plane, mesh);

        this.connectors[0].setFromSegments(crossSectionResult.segments);

        this.result.length = crossSectionResult.length;
        this.result.ready = true;
      }
    },

    positionPlaneMarker: function() {
      if (!this.isPlanar()) return;

      var marker = this.markers[0];

      var min = this.result.min;
      var max = this.result.max;

      if (Math.abs(min.length()) === Infinity) marker.deactivate();

      // move the marker to the center
      var center = max.clone().add(min).multiplyScalar(0.5);
      marker.setPosition(center);

      // cross-section marker extends by 0.1 size in each direction
      var size = max.clone().sub(min).multiplyScalar(1.5);
      if (size.x <= 0) size.x = 1;
      if (size.y <= 0) size.y = 1;
      if (size.z <= 0) size.z = 1;
      marker.setScale(size);

      marker.activate();
    },

    positionConnectors: function() {
      // position connector
      if (this.isLinear()) {
        for (var c = 0; c < this.cnum; c++) {
          var ms = this.markers[(this.midx + c) % this.mnum];
          var mt = this.markers[(this.midx + 1 + c) % this.mnum];

          if (ms.active && mt.active) {
            this.connectors[c].setFromPointPair(ms.getPosition(), mt.getPosition());
            this.connectors[c].activate();
          }
        }
      }
      else if (this.isCircular()) {
        var connector = this.connectors[0];

        // if result is valid, position the connector and turn it on
        if (this.result.ready) {
          var normal = this.result.normal;
          var center = this.result.center;
          var radius = this.result.radius;

          connector.setFromNormalAndCenter(normal, center);
          connector.setScale(new Vector3().setScalar(radius));

          connector.activate();
        }
        // else, turn off the connector because its parameters are invalid
        else {
          connector.deactivate();
        }
      }
      else {
        this.connectors[0].activate();
      }
    },

    setMarkerColors: function(color) {
      var markers = this.markers;

      // start color and color increment
      color = color !== undefined ? color : 0x2adeff;
      var dcolor = 0x300000;

      for (var m = 0; m < this.mnum; m++) {
        var idx = (this.midx - m + this.mnum) % this.mnum;
        this.markers[idx].setColor(color);
        color = Math.max(color + dcolor, 0);
      }
    },

    setConnectorColors: function(color) {
      var connectors = this.connectors;
      color = color !== undefined ? color : 0x8adeff;

      for (var c = 0; c < this.cnum; c++) {
        this.connectors[c].setColor(color);
      }
    },

    makeResult: function(ready) {
      return {
        ready: ready || false
      };
    },

    isPlanar: function() {
      return this.type === Measurement.Types.crossSection || this.type === Measurement.Types.orientedCrossSection;
    },

    isLinear: function() {
      return this.type === Measurement.Types.length || this.type === Measurement.Types.angle;
    },

    isCircular: function() {
      return this.type === Measurement.Types.circle;
    },

    updateFromCamera: function(camera) {
      // only update if active and measurement uses non-plane markers
      if (!this.active || this.isPlanar()) return;

      for (var m = 0; m < this.mnum; m++) {
        var marker = this.markers[m];

        if (marker.type !== Marker.Types.point) continue;

        var dist = camera.position.distanceTo(marker.getPosition());

        marker.setRadius(dist * 0.005);
      }
    },

    scaleFromCenter: function(factor, center) {
      if (!this.active) return;

      for (var m = 0; m < this.mnum; m++) {
        this.markers[m].scaleFromCenter(factor, center);
      }

      for (var c = 0; c < this.cnum; c++) {
        this.connectors[c].scaleFromCenter(factor, center);
      }

      // copy the current result
      var result = Object.assign({}, this.result);

      if (!result.ready) return;

      // adjust the result values given the factor

      // all three components of factor are assumed to be the same (if factor
      // is a vector), so pick one
      var f = factor.isVector3 ? factor.x : factor;

      if (this.type === Measurement.Types.length) {
        result.length *= f;
      }
      else if (this.type === Measurement.Types.circle) {
        result.radius *= f;
        result.diameter *= f;
        result.circumference *= f;
        result.area *= f * f;
        result.center.sub(center).multiplyScalar(f).add(center);
      }
      else if (this.type === Measurement.Types.crossSection) {
        result.area *= f * f;
        result.min.sub(center).multiplyScalar(f).add(center);
        result.max.sub(center).multiplyScalar(f).add(center);
        result.length *= f;
      }

      // update result
      this.result = result;

      if (this.onResultChange) {
        this.onResultChange(this.result);
      }
    },

    translate: function(delta) {
      if (!this.active) return;

      for (var m = 0; m < this.mnum; m++) {
        this.markers[m].translate(delta);
      }

      for (var c = 0; c < this.cnum; c++) {
        this.connectors[c].translate(delta);
      }
    },

    deactivate: function() {
      this.active = false;

      this.pointer.removeClickCallback(this.pointerCallbackIdx);
      this.pointerCallbackIdx = -1;

      this.pointer.deactivate();

      removeMeshByName(this.scene, "measurementMarker");
      removeMeshByName(this.scene, "measurementConnector");

      this.onResultChange = null;
    }

  });



  // utility functions

  // clamp a number to two boundary values
  function clamp(x, minVal, maxVal) {
    if (x < minVal) x = minVal;
    else if (x > maxVal) x = maxVal;
    return x;
  }
  // compute acos, but clamp the input
  function acos(a) { return Math.acos(clamp(a, -1, 1)); }
  // compute asin, but clamp the input
  function asin(a) { return Math.asin(clamp(a, -1, 1)); }



  // marker/connector types and factories

  // abstract Marker class
  function Marker(params) {
    params = params || {};

    this.active = false;

    this.mesh = new THREE.Mesh();
    this.mesh.visible = false;
    this.mesh.name = "measurementMarker";

    this.type = "";
  }

  Marker.Types = {
    none: "none",
    point: "point",
    plane: "plane"
  };

  Object.assign(Marker.prototype, {
    // set the material color
    setColor: function(color) {
      this.mesh.material.color.set(color);
      return this;
    },

    addToScene: function(scene) {
      scene.add(this.mesh);
      return this;
    },

    activate: function() {
      this.active = true;
      this.mesh.visible = true;
      return this;
    },

    deactivate: function() {
      this.active = false;
      this.mesh.visible = false;
      return this;
    }
  });

  // derived marker class representing a point
  function PointMarker(params) {
    params = params || {};

    Marker.call(this, params);

    var radius = params.radius || 1;
    var widthSegments = params.widthSegments || 16;
    var heightSegments = params.heightSegments || 8;
    var geo = new THREE.SphereBufferGeometry(radius, widthSegments, heightSegments);
    var mat = params.material ? params.material.clone() : new THREE.MeshStandardMaterial({
      color: 0xffffff
    });

    this.mesh.geometry = geo;
    this.mesh.material = mat;

    this.type = Marker.Types.point;
  }

  PointMarker.prototype = Object.create(Marker.prototype);
  Object.assign(PointMarker.prototype, {
    constructor: PointMarker,

    setPosition: function(position) {
      this.mesh.position.copy(position);
      return this;
    },

    getPosition: function() {
      return this.mesh.position;
    },

    setRadius: function(radius) {
      this.mesh.scale.set(radius, radius, radius);

      return this;
    },

    scaleFromCenter: function(factor, center) {
      if (!factor.isVector3) factor = new Vector3().setScalar(factor);
      this.mesh.position.sub(center).multiply(factor).add(center);

      return this;
    },

    translate: function(delta) {
      this.mesh.position.add(delta);

      return this;
    }
  });

  // derived marker class representing a plane
  function PlaneMarker(params) {
    params = params || {};

    Marker.call(this, params);

    var dim = params.dim || 1;
    var geo = new THREE.PlaneBufferGeometry(dim, dim);

    // geometry points up z by default, so reorient if necessary
    if (params.axis === "x") geo.rotateY(Math.PI / 2);
    else if (params.axis === "y") geo.rotateX(Math.PI / 2);

    var mat = params.material ? params.material.clone : new THREE.MeshStandardMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.25,
      side: THREE.DoubleSide
    });

    // display mesh
    this.mesh.geometry = geo;
    this.mesh.material = mat;

    this.normal = params.normal || new THREE.Vector(0, 0, 1);

    this.type = Marker.Types.plane;
  }

  PlaneMarker.prototype = Object.create(Marker.prototype);
  Object.assign(PlaneMarker.prototype, {
    constructor: PointMarker,

    setPosition: function(point) {
      // position display mesh
      this.mesh.position.copy(point);

      return this;
    },

    getPosition: function() {
      return this.mesh.position;
    },

    setScale: function(scale) {
      this.mesh.scale.copy(scale);

      return this;
    },

    scaleFromCenter: function(factor, center) {
      if (!factor.isVector3) factor = new Vector3().setScalar(factor);
      this.mesh.position.sub(center).multiply(factor).add(center);

      this.mesh.scale.multiply(factor);

      return this;
    },

    translate: function(delta) {
      this.mesh.position.add(delta);

      return this;
    }
  });

  // creates markers of a given type
  function MarkerFactory() {
    this.make = function(type, params) {
      if (type === Marker.Types.point) {
        return new PointMarker(params);
      }
      else if (type === Marker.Types.plane) {
        return new PlaneMarker(params);
      }
      else return null;
    };
  }

  // abstract Connector class
  function Connector(params) {
    params = params || {};

    this.active = false;

    this.mesh = new THREE.LineSegments();
    this.mesh.visible = false;
    this.mesh.name = "measurementConnector";

    this.type = "";
  }

  Connector.Types = {
    none: "none",
    circle: "circle",
    line: "line",
    contour: "contour"
  };

  Object.assign(Connector.prototype, {
    // set the material color
    setColor: function(color) {
      this.mesh.material.color.set(color);
      return this;
    },

    addToScene: function(scene) {
      scene.add(this.mesh);
      return this;
    },

    activate: function() {
      this.active = true;
      this.mesh.visible = true;
      return this;
    },

    deactivate: function() {
      this.active = false;
      this.mesh.visible = false;
      return this;
    }
  });

  // derived connector class representing a line
  function LineConnector(params) {
    params = params || {};

    Connector.call(this, params);

    var geo = new THREE.Geometry();
    var vertices = geo.vertices;
    vertices.push(new Vector3());
    vertices.push(new Vector3());
    var mat = params.material ? params.material.clone() : new THREE.LineBasicMaterial({
      color: 0xffffff
    });

    this.mesh.geometry = geo;
    this.mesh.material = mat;

    this.type = Connector.Types.line;
  }

  LineConnector.prototype = Object.create(Connector.prototype);
  Object.assign(LineConnector.prototype, {
    constructor: LineConnector,

    setFromPointPair: function(a, b) {
      var geo = this.mesh.geometry;
      var vertices = geo.vertices;

      vertices[0].copy(a);
      vertices[1].copy(b);

      geo.verticesNeedUpdate = true;

      return this;
    },

    scaleFromCenter: function(factor, center) {
      if (!factor.isVector3) factor = new Vector3().setScalar(factor);

      var geo = this.mesh.geometry;
      var vertices = geo.vertices;

      vertices[0].sub(center).multiply(factor).add(center);
      vertices[1].sub(center).multiply(factor).add(center);

      geo.verticesNeedUpdate = true;

      return this;
    },

    translate: function(delta) {
      var vertices = this.mesh.geometry.vertices;

      vertices[0].add(delta);
      vertices[1].add(delta);

      this.mesh.geometry.verticesNeedUpdate = true;

      return this;
    }
  });

  // derived connector class representing a circle
  function CircleConnector(params) {
    params = params || {};

    Connector.call(this, params);

    var geo = new THREE.Geometry();
    var vertices = geo.vertices;

    var r = params.radius || 1;
    var segments = params.segments || 64;
    var dt = 2 * Math.PI / segments;

    for (var i = 0; i <= segments; i++) {
      var theta = i * dt;
      vertices.push(new Vector3(r*Math.cos(theta), r*Math.sin(theta), 0));
      vertices.push(new Vector3(r*Math.cos(theta+dt), r*Math.sin(theta+dt), 0));
    }
    var mat = params.material ? params.material.clone() : new THREE.LineBasicMaterial({
      color: 0xffffff
    });

    this.mesh.geometry = geo;
    this.mesh.material = mat;

    this.type = Connector.Types.circle;
  }

  CircleConnector.prototype = Object.create(Connector.prototype);
  Object.assign(CircleConnector.prototype, {
    constructor: CircleConnector,

    setFromNormalAndCenter: function(normal, center) {
      this.mesh.position.copy(center);
      this.mesh.lookAt(center.clone().add(normal));

      return this;
    },

    setScale: function(scale) {
      this.mesh.scale.copy(scale);

      return this;
    },

    scaleFromCenter: function(factor, center) {
      if (!factor.isVector3) factor = new Vector3().setScalar(factor);

      this.mesh.position.sub(center).multiply(factor).add(center);
      this.mesh.scale.multiply(factor);

      return this;
    },

    translate: function(delta) {
      this.mesh.position.add(delta);

      return this;
    }
  });

  function ContourConnector(params) {
    params = params || {};

    Connector.call(this, params);

    var geo = new THREE.Geometry();
    var mat = params.material ? params.material.clone() : new THREE.LineBasicMaterial({
      color: 0xffffff
    });

    this.mesh.geometry = geo;
    this.mesh.material = mat;

    this.type = Connector.Types.contour;
  }

  ContourConnector.prototype = Object.create(Connector.prototype);
  Object.assign(ContourConnector.prototype, {
    constructor: ContourConnector,

    setFromSegments: function(segments) {
      if (!segments) return;

      // when this connector is set from a set of segments (in world space),
      // reset the mesh position to 0 and rebuild geometry
      this.mesh.position.setScalar(0);
      this.mesh.scale.setScalar(1);

      var geo = new THREE.Geometry();
      var vertices = geo.vertices;

      for (var s = 0, l = segments.length; s < l; s++) {
        var segment = segments[s];

        vertices.push(segment.start);
        vertices.push(segment.end);
      }

      this.mesh.geometry = geo;

      return this;
    },

    setScale: function(scale) {
      this.mesh.scale.copy(scale);

      return this;
    },

    scaleFromCenter: function(factor, center) {
      if (!factor.isVector3) factor = new Vector3().setScalar(factor);

      this.mesh.position.sub(center).multiply(factor).add(center);
      this.mesh.scale.multiply(factor);

      return this;
    },

    translate: function(delta) {
      this.mesh.position.add(delta);

      return this;
    }
  });

  // creates connectors of a given type
  function ConnectorFactory() {
    this.make = function(type, params) {
      if (type === Connector.Types.line) {
        return new LineConnector(params);
      }
      else if (type === Connector.Types.circle) {
        return new CircleConnector(params);
      }
      else if (type === Connector.Types.contour) {
        return new ContourConnector(params);
      }
      else return null;
    };
  }



  return Measurement;

})();
