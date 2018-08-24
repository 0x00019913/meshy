var Measurement = (function() {

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

    this.result = {
      ready: false
    };

    // index of the marker due to be placed next
    this.midx = 0;
    // index of the connector that connects to the marker
    this.cidx = 0;
    // total number of markers and connectors
    this.mnum = 0;
    this.cnum = 0;
    // number of active markers
    this.mactive = 0;

    // type of markers and connectors
    this.mtype = Marker.Types.none;
    this.ctype = Connector.Types.none;

    this.pointerCallbackIdx = -1;

    // optionally called when a valid result has been calculated
    this.onResultReady = null;
  }

  Measurement.Types = {
    none: "none",
    length: "length",
    angle: "angle",
    circle: "circle",
    crossSection: "crossSection"
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
      this.cidx = 0;
      this.mnum = 0;
      this.cnum = 0;
      this.mactive = 0;

      this.mtype = Marker.Types.none;
      this.ctype = Connector.Types.none;

      this.result = {
        ready: false
      };

      var mparams = {};
      var cparams = {};

      var mfactory = this.markerFactory;
      var cfactory = this.connectorFactory;
      var scene = this.scene;

      // set the correct number and types of markers and connectors
      if (type === Measurement.Types.length) {
        this.mnum = 2;
        this.cnum = 1;
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.line;
      }
      else if (type === Measurement.Types.angle) {
        this.mnum = 3;
        this.cnum = 2;
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.line;
      }
      else if (type === Measurement.Types.circle) {
        this.mnum = 3;
        this.cnum = 1;
        this.mtype = Marker.Types.point;
        this.ctype = Connector.Types.circle;
      }
      else if (type === Measurement.Types.crossSection) {
        this.mnum = 1;
        this.cnum = 0;
        this.mtype = Marker.Types.plane;
        this.params.axis = this.params.axis || "z";
        this.params.normal = this.params.normal || axisToVector3(this.params.axis);

        // use this normal to create the plane marker
        mparams.axis = this.params.axis;
        mparams.normal = this.params.normal;
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

      this.pointerCallbackIdx = this.pointer.addClickCallback(this.onClick.bind(this));
      this.pointer.activate();
    },

    onClick: function(intersection) {
      this.mactive = Math.min(this.mnum, this.mactive + 1);

      var marker = this.markers[this.midx];
      var connector = this.connectors[this.cidx];

      var point = intersection.point;

      this.calculateMeasurement(intersection);

      // position markers and connectors

      // if plane, just position the marker given the measurement result
      if (this.isPlanar()) {
        var min = this.result.min;
        var max = this.result.max;

        var center = max.clone().add(min).multiplyScalar(0.5);
        marker.setPosition(center);

        // cross-section marker extends by 0.1 size in each direction
        var size = max.clone().sub(min).multiplyScalar(1.1);
        if (size.x <= 0) size.x = 1;
        if (size.y <= 0) size.y = 1;
        if (size.z <= 0) size.z = 1;
        marker.setScale(size);
      }
      // else, position the 2-3 markers and their connectors
      else {
        // position marker
        marker.setPosition(point);

        // position connector
        if (this.isLinear()) {
          if (this.mactive > 0) {
            var pprev = this.markers[(this.midx - 1 + this.mnum) % this.mnum].getPosition();

            connector.setFromPointPair(pprev, point);
          }
        }
        else if (this.isCircular()) {
          // if result is valid, position the connector and turn it on
          if (this.result.ready) {
            var normal = this.result.normal;
            var center = this.result.center;
            var radius = this.result.radius;

            connector.setFromNormalAndCenter(normal, center);
            connector.setScale(new THREE.Vector3().setScalar(radius));

            connector.activate();
          }
          // turn off the connector if its parameters are not valid
          else {
            connector.deactivate()
          }
        }
      }

      if (this.onResultReady) {
        this.onResultReady(this.result);
      }

      marker.activate();

      this.setMarkerColors();
      this.setConnectorColors();

      this.midx = (this.midx + 1) % this.mnum;
      this.cidx = (this.cidx + 1) % this.cnum;
    },

    calculateMeasurement: function(intersection) {
      var point = intersection.point;

      // if not enough markers, do nothing
      if (this.mactive < this.mnum) return;

      if (this.type === Measurement.Types.length) {
        var p0 = this.markers[(this.midx - 1 + this.mnum) % this.mnum].getPosition();
        var p1 = point;

        this.result.length = p0.distanceTo(p1);
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.angle) {
        var p0 = this.markers[(this.midx - 2 + this.mnum) % this.mnum].getPosition();
        var p1 = this.markers[(this.midx - 1 + this.mnum) % this.mnum].getPosition();
        var p2 = point;

        var dot = p0.clone().sub(p1).dot(p2.clone().sub(p1));

        this.result.angle = acos(dot);
        this.result.angleDegrees = this.result.angle * 180.0 / Math.PI;
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.circle) {
        var p0 = this.markers[(this.midx - 2 + this.mnum) % this.mnum].getPosition();
        var p1 = this.markers[(this.midx - 1 + this.mnum) % this.mnum].getPosition();
        var p2 = point;

        // calculate circle center and normal from three coplanar points:
        // take two pairs of coplanar points, calculate bisector of both pairs;
        // the bisectors will intersect at the center

        var sa = p0.clone().sub(p1);
        var sb = p2.clone().sub(p1);

        // normal
        var normal = sa.clone().cross(sb).normalize();

        // if points are collinear, can't compute the circle, so unready the
        // result and return
        if (normal.length() === 0) {
          this.result = {
            ready: false
          };

          return;
        }

        // bisector points
        var pa = p0.clone().add(p1).multiplyScalar(0.5);
        var pb = p2.clone().add(p1).multiplyScalar(0.5);

        // bisector directions
        var da = normal.clone().cross(sa).normalize();
        var db = normal.clone().cross(sb).normalize();

        // the bisectors won't necessarily intersect exactly, but we can
        // calculate a point of closest approach:
        // if line 0 and 1 are
        // v0 = p0 + t0d0, v1 = p1 + t1d1, then
        // t0 = ((d0 - d1 (d0 dot d1)) dot (p1 - p0)) / (1 - (d0 dot d1)^2)
        // t1 = ((d0 (d0 dot d1) - d1) dot (p1 - p0)) / (1 - (d0 dot d1)^2)

        var dadb = da.dot(db);
        var denominator = 1 - dadb * dadb;

        // just in case, to avoid division by 0
        if (denominator === 0) return;

        // scalar parameter
        var ta = da.clone().addScaledVector(db, -dadb).dot(pb.clone().sub(pa)) / denominator;

        var center = pa.clone().addScaledVector(da, ta);
        var radius = center.distanceTo(p2);

        this.result.radius = radius;
        this.result.diameter = radius * 2;
        this.result.circumference = radius * 2 * Math.PI;
        this.result.area = radius * radius * Math.PI;
        this.result.center = center;
        this.result.normal = normal;
        this.result.ready = true;
      }
      else if (this.type === Measurement.Types.crossSection) {
        var plane = new THREE.Plane();
        plane.setFromNormalAndCoplanarPoint(this.params.normal, point);

        var crossSectionData = Calculate.crossSection(plane, intersection.object);
        this.result.crossSection = crossSectionData.crossSection;
        this.result.min = crossSectionData.min;
        this.result.max = crossSectionData.max;
        this.result.ready = true;
      }
    },

    setMarkerColors: function() {
      var markers = this.markers;
      // start color and color increment
      var color = 0x2adeff;
      var dcolor = 0x300000;

      for (var m = 0; m < this.mnum; m++) {
        var idx = (this.midx - m + this.mnum) % this.mnum;
        this.markers[idx].setColor(color);
        color = Math.max(color + dcolor, 0);
      }
    },

    setConnectorColors: function() {
      var connectors = this.connectors;
      var color = 0xffff66;

      for (var c = 0; c < this.cnum; c++) {
        this.connectors[c].setColor(color);
      }
    },

    isPlanar: function() {
      return this.type === Measurement.Types.crossSection;
    },

    isLinear: function() {
      return this.type === Measurement.Types.length || this.type === Measurement.Types.angle;
    },

    isCircular: function() {
      return this.type === Measurement.Types.circle;
    },

    updateMarkers: function(camera) {
      // only update if active and measurement uses non-plane markers
      if (!this.active || this.isPlanar()) return;

      for (var m = 0; m < this.mnum; m++) {
        var marker = this.markers[m];

        if (marker.type !== Marker.Types.point) continue;

        var dist = camera.position.distanceTo(marker.getPosition());

        marker.setRadius(dist * 0.005);
      }
    },

    deactivate: function() {
      this.active = false;

      this.pointer.removeClickCallback(this.pointerCallbackIdx);
      this.pointerCallbackIdx = -1;

      this.pointer.deactivate();

      removeMeshByName(this.scene, "measurementMarker");
      removeMeshByName(this.scene, "measurementConnector");

      this.onResultReady = null;
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
      this.mesh.visible = true;
      return this;
    },

    deactivate: function() {
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
      opacity: 0.5,
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
    },

    setScale: function(scale) {
      this.mesh.scale.copy(scale);
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

    this.mesh = new THREE.Line();
    this.mesh.visible = false;
    this.mesh.name = "measurementConnector";

    this.type = "";
  }

  Connector.Types = {
    none: "none",
    circle: "circle",
    line: "line"
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
      this.mesh.visible = true;
      return this;
    },

    deactivate: function() {
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
    vertices.push(new THREE.Vector3());
    vertices.push(new THREE.Vector3());
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
    var dtheta = 2 * Math.PI / segments;

    for (var i = 0; i <= segments; i++) {
      var theta = i * dtheta;
      vertices.push(new THREE.Vector3(r*Math.cos(theta), r*Math.sin(theta), 0));
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
      else return null;
    };
  }



  return Measurement;

})();
