var Measurement = (function() {

  var Vector3 = THREE.Vector3;
  var Plane = THREE.Plane;

  function axisToVector3(axis) {
    var v = new Vector3();
    v[axis] = 1;
    return v;
  }

  // push b's terms onto a without using concat - jsperf testing indicates that
  // this is faster
  function arrayAppend(target, source) {
    var sourceLength = source.length;

    for (var i = 0; i < sourceLength; i++) target.push(source[i]);
  }

  // Measurement constructor

  function Measurement(pointer, scene) {
    this.pointer = pointer;
    this.scene = scene;

    this.active = false;
    this.params = null;

    this.result = this.makeResult(false);

    // index of the point due to be set
    this.pidx = 0;
    // number of active primary markers
    this.pnumactive = 0;

    // primary and secondary markers; primary markers are placed by the user,
    // while secondary markers are derived from the configuration of the
    // primary markers
    this.pmarkers = [];
    this.smarkers = [];

    // total numbers of primary/secondary markers
    this.pnum = 0;
    this.snum = 0;

    // type of primary/secondary markers
    this.ptype = Markers.Types.none;
    this.stype = Markers.Types.none;

    this.mesh = null;

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

    activate: function(params) {
      this.active = true;

      this.params = params || {};
      this.params.type = this.params.type || Measurement.Types.length;
      this.params.color = this.params.color || 0x2adeff;

      // if true, don't automatically calculate the measurement when there are
      // enough points - necessiatates a manual call to .calculate()
      this.params.calculateManually = this.params.calculateManually || false;

      this.pmarkers.length = 0;
      this.smarkers.length = 0;

      this.pidx = 0;
      this.pnum = 0;
      this.snum = 0;
      this.pnumactive = 0;

      this.ptype = Markers.Types.none;
      this.stype = Markers.Types.none;

      this.result = this.makeResult(false);

      var pparams = { name: "measurementMarker" };
      var sparams = { name: "measurementMarker" };

      var scene = this.scene;
      var type = this.params.type;

      // set the correct number and types of markers
      if (type === Measurement.Types.length) {
        this.pnum = 2; // 2 sphere markers
        this.snum = 1; // 1 line marker
        this.ptype = Markers.Types.sphere;
        this.stype = Markers.Types.line;
      }
      else if (type === Measurement.Types.angle) {
        this.pnum = 3; // 3 sphere markers
        this.snum = 2; // 2 line marker
        this.ptype = Markers.Types.sphere;
        this.stype = Markers.Types.line;
      }
      else if (type === Measurement.Types.circle) {
        this.pnum = 3; // 3 sphere markers
        this.snum = 1; // 1 circle marker
        this.ptype = Markers.Types.sphere;
        this.stype = Markers.Types.circle;
      }
      else if (type === Measurement.Types.crossSection) {
        this.pnum = 1; // 1 plane marker
        this.snum = 1; // 1 contour marker
        this.ptype = Markers.Types.plane;
        this.stype = Markers.Types.contour;

        this.params.axis = this.params.axis || "z";
        // normal of the axis-oriented plane denoting the cross-section
        this.params.normal = this.params.normal || axisToVector3(this.params.axis);
        this.params.splitContours = this.params.splitContours || false;

        // use this normal to create the plane marker
        pparams.axis = this.params.axis;
        pparams.normal = this.params.normal;
      }
      else if (type === Measurement.Types.orientedCrossSection) {
        this.pnum = 3; // 3 sphere markers
        this.snum = 1; // 1 contour Marker
        this.ptype = Markers.Types.sphere;
        this.stype = Markers.Types.contour;

        // true if selecting only the closest contour to the center of the circle
        // subtended by the markers
        this.params.nearestContour = this.params.nearestContour || false;
        // true if splitting the segment soup into an array of contiguous loops,
        // and necessarily true if finding the nearest contour
        this.params.splitContours = this.params.nearestContour || this.params.splitContours || false;
      }
      else return;

      // generate the markers and add them to the scene
      for (var ip = 0; ip < this.pnum; ip++) {
        var marker = Markers.create(this.ptype, pparams);
        marker.setColor(this.params.color);
        marker.addToScene(scene);
        this.pmarkers.push(marker);
      }
      for (var is = 0; is < this.snum; is++) {
        var marker = Markers.create(this.stype, sparams);
        marker.setColor(this.params.color);
        marker.addToScene(scene);
        this.smarkers.push(marker);
      }

      // if the params already contain the points necessary to compute the
      // measurement, place the markers and compute the measurement
      if (this.isFullyDetermined()) {
        this.pnumactive = this.pnum;
        this.pidx = 0;

        this.calculate();

        this.positionMarkers();
      }
      // else, initialize the points
      else {
        this.params.p = [];

        for (var p = 0; p < this.pnum; p++) this.params.p.push(null);
      }

      this.pointerCallbackIdx = this.pointer.addClickCallback(this.placePoint.bind(this));
      this.pointer.activate();
    },

    getType: function() {
      return this.params.type;
    },

    placePoint: function(intersection) {
      var point = intersection.point;
      var mesh = intersection.object;

      this.mesh = mesh;

      this.params.p[this.pidx] = point;
      this.pnumactive = Math.min(this.pnum, this.pnumactive + 1);
      this.pidx = (this.pidx + 1) % this.pnum;

      this.calculate();

      this.positionMarkers();
    },

    getParams: function() {
      return this.params;
    },

    // return true if a sufficient number of points is given
    isFullyDetermined: function() {
      if (!this.params.p) return false;

      var type = this.params.type;

      if (type === Measurement.Types.length) {
        // need 2 constraining points
        return this.params.p[0] && this.params.p[1];
      }
      else if (type === Measurement.Types.angle) {
        // need 3 constraining points
        return this.params.p[0] && this.params.p[1] && this.params.p[2];
      }
      else if (type === Measurement.Types.circle) {
        // need 3 constraining points
        return this.params.p[0] && this.params.p[1] && this.params.p[2];
      }
      else if (type === Measurement.Types.crossSection) {
        // need 1 constraining point
        return this.params.p[0];
      }
      else if (type === Measurement.Types.orientedCrossSection) {
        // need 3 constraining points
        return this.params.p[0] && this.params.p[1] && this.params.p[2];
      }
      else return true;
    },

    calculate: function() {
      // if not enough points, do nothing
      if (!this.isFullyDetermined()) return;

      this.result = this.makeResult(false);

      var type = this.params.type;

      if (type === Measurement.Types.length) {
        var p0 = this.params.p[0];
        var p1 = this.params.p[1];

        if (p0 === null || p1 === null) return;

        this.result.length = p0.distanceTo(p1);
        this.result.ready = true;
      }
      else if (type === Measurement.Types.angle) {
        var p0 = this.params.p[0];
        var p1 = this.params.p[1];
        var p2 = this.params.p[2];

        if (p0 === null || p1 === null || p2 === null) return;

        var d10 = new Vector3().subVectors(p0, p1).normalize();
        var d12 = new Vector3().subVectors(p2, p1).normalize();
        var dot = d10.dot(d12);

        this.result.angle = acos(dot);
        this.result.angleDegrees = this.result.angle * 180.0 / Math.PI;
        this.result.ready = true;
      }
      else if (type === Measurement.Types.circle) {
        var p0 = this.params.p[0];
        var p1 = this.params.p[1];
        var p2 = this.params.p[2];

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
      else if (type === Measurement.Types.crossSection) {
        var normal = this.params.normal;
        var point = this.params.p[0];

        if (normal === null || point === null) return;

        var mesh = this.mesh;
        var plane = new Plane();
        plane.setFromNormalAndCoplanarPoint(normal, point);

        var crossSectionResult = Calculate.crossSection(plane, mesh, this.params.splitContours);

        var segments = [];
        var area = 0;
        var length = 0;
        var boundingBox = new THREE.Box3();

        // accumulate the result
        for (var s = 0, ls = crossSectionResult.length; s < ls; s++) {
          var contour = crossSectionResult[s];

          arrayAppend(segments, contour.segments);
          area += contour.area;
          length += contour.length;
          boundingBox.expandByPoint(contour.boundingBox.min);
          boundingBox.expandByPoint(contour.boundingBox.max);
        }

        this.smarkers[0].setFromSegments(segments);

        this.result.area = area;
        this.result.boundingBox = boundingBox;
        this.result.length = length;
        this.result.crossSectionResult = crossSectionResult;
        this.result.ready = true;
      }
      else if (type === Measurement.Types.orientedCrossSection) {
        var p0 = this.params.p[0];
        var p1 = this.params.p[1];
        var p2 = this.params.p[2];

        // compute the circle parameters from three points
        var circle = Calculate.circleFromThreePoints(p0, p1, p2);

        if (!circle) return;

        var center = circle.center;
        var normal = circle.normal;
        var circleArea = circle.radius * circle.radius * Math.PI;

        // compute plane-mesh intersection
        var mesh = this.mesh;
        var plane = new Plane();
        plane.setFromNormalAndCoplanarPoint(normal, center);

        var crossSectionResult = Calculate.crossSection(plane, mesh, this.params.splitContours);

        // process the intersection result

        var segments = [];
        var area = 0;
        var length = 0;
        var boundingBox = new THREE.Box3();

        // if getting the nearest contour, retrieve it and use it as the measurement result
        if (this.params.nearestContour) {
          if (crossSectionResult.length > 1) {
            var nearestContour = null;

            // the three markers will all have some distance from the nearest
            // contour - they should all be exactly on the contour, so their
            // total distance to the closest segments of the contour should be
            // about 0; use this fact to find the closest contour
            var minDist = Infinity;

            var closestPoint = new THREE.Vector3();

            for (var c = 0, lc = crossSectionResult.length; c < lc; c++) {
              var contour = crossSectionResult[c];

              // minimum distances of each marker point to the contour's segments
              var minDist0 = Infinity;
              var minDist1 = Infinity;
              var minDist2 = Infinity;

              for (var s = 0, ls = contour.segments.length; s < ls; s++) {
                var segment = contour.segments[s];

                segment.closestPointToPoint(p0, false, closestPoint);
                minDist0 = Math.min(minDist0, closestPoint.distanceTo(p0));
                segment.closestPointToPoint(p1, false, closestPoint);
                minDist1 = Math.min(minDist1, closestPoint.distanceTo(p1));
                segment.closestPointToPoint(p2, false, closestPoint);
                minDist2 = Math.min(minDist2, closestPoint.distanceTo(p2));
              }

              var distSum = minDist0 + minDist1 + minDist2;

              if (distSum < minDist) {
                nearestContour = contour;
                minDist = distSum;
              }
            }

            crossSectionResult = [nearestContour];
          }
        }

        // accumulate the result
        for (var c = 0, lc = crossSectionResult.length; c < lc; c++) {
          var contour = crossSectionResult[c];

          arrayAppend(segments, contour.segments);
          area += contour.area;
          length += contour.length;
          boundingBox.expandByPoint(contour.boundingBox.min);
          boundingBox.expandByPoint(contour.boundingBox.max);
        }

        this.smarkers[0].setFromSegments(segments);

        this.result.area = Math.abs(area);
        this.result.boundingBox = boundingBox;
        this.result.length = length;
        this.result.crossSectionResult = crossSectionResult;
        this.result.ready = true;
      }

      if (this.onResultChange) {
        this.onResultChange(this.result);
      }
    },

    positionMarkers: function() {
      // position primary markers

      if (this.ptype === Markers.Types.sphere) {
        for (var m = 0; m < this.pnum; m++) {
          var pos = this.params.p[m];

          if (pos !== null) {
            var marker = this.pmarkers[(this.pidx + m) % this.pnum];

            marker.setPosition(pos);
            marker.activate();
          }
        }
      }
      else if (this.ptype === Markers.Types.plane) {
        var marker = this.pmarkers[0];

        // if no valid bounding box to which to size the marker, deactivate
        if (Math.abs(this.result.boundingBox.min.length()) === Infinity) {
          marker.deactivate();
        }

        marker.setFromBoundingBox(this.result.boundingBox, 1.5);

        marker.activate();
      }

      // position secondary markers

      if (this.stype === Markers.Types.line) {
        for (var m = 0; m < this.snum; m++) {
          var ps = this.params.p[(this.pidx + m) % this.pnum];
          var pt = this.params.p[(this.pidx + 1 + m) % this.pnum];

          if (ps && pt) {
            this.smarkers[m].setFromPointPair(ps, pt);
            this.smarkers[m].activate();
          }
          else {
            this.smarkers[m].deactivate();
          }
        }
      }
      else if (this.stype === Markers.Types.circle) {
        var marker = this.smarkers[0];

        // if result is valid, position the marker and turn it on
        if (this.result.ready) {
          var normal = this.result.normal;
          var center = this.result.center;
          var radius = this.result.radius;

          marker.setCenter(this.result.center);
          marker.setNormal(this.result.normal);
          marker.setScale(this.result.radius);

          marker.activate();
        }
        // else, turn off the marker because its parameters are invalid
        else {
          marker.deactivate();
        }
      }
      else if (this.stype === Markers.Types.contour) {
        if (this.result.ready) {
          this.smarkers[0].activate();
        }
      }
      else {
        this.smarkers[0].activate();
      }
    },

    makeResult: function(ready) {
      return {
        ready: ready || false
      };
    },

    updateFromCamera: function(camera) {
      // only update if active and measurement uses non-plane markers
      if (!this.active || this.ptype !== Markers.Types.sphere) return;

      for (var m = 0; m < this.pnum; m++) {
        var marker = this.pmarkers[m];

        if (marker.type !== Markers.Types.sphere) continue;

        var dist = camera.position.distanceTo(marker.getPosition());

        marker.setRadius(dist * 0.005);
      }
    },

    scaleFromPoint: function(factor, point) {
      if (!this.active) return;

      for (var m = 0; m < this.pnum; m++) {
        this.pmarkers[m].scaleFromPoint(factor, point);
      }

      for (var m = 0; m < this.snum; m++) {
        this.smarkers[m].scaleFromPoint(factor, point);
      }

      // copy the current result
      var result = Object.assign({}, this.result);

      if (!result.ready) return;

      // adjust the result values given the factor

      // all three components of factor are assumed to be the same (if factor
      // is a vector), so pick one
      var f = factor.isVector3 ? factor.x : factor;

      if (this.params.type === Measurement.Types.length) {
        result.length *= f;
      }
      else if (this.params.type === Measurement.Types.circle) {
        result.radius *= f;
        result.diameter *= f;
        result.circumference *= f;
        result.area *= f * f;
        result.center.sub(point).multiplyScalar(f).add(point);
      }
      else if (this.params.type === Measurement.Types.crossSection
        || this.params.type === Measurement.Types.orientedCrossSection) {
        result.area *= f * f;
        result.boundingBox.min.sub(point).multiplyScalar(f).add(point);
        result.boundingBox.max.sub(point).multiplyScalar(f).add(point);
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

      for (var m = 0; m < this.pnum; m++) {
        this.pmarkers[m].translate(delta);
      }

      for (var c = 0; c < this.snum; c++) {
        this.smarkers[c].translate(delta);
      }

      // translate relevant quantities in the computed result

      if (!this.result.ready) return;

      if (this.params.type === Measurement.Types.circle) {
        this.result.center.add(delta);
      }
      else if (this.params.type === Measurement.Types.crossSection
        || this.params.type === Measurement.Types.orientedCrossSection) {
        this.result.boundingBox.translate(delta);
      }
    },

    deactivate: function() {
      this.active = false;

      this.pointer.removeClickCallback(this.pointerCallbackIdx);
      this.pointerCallbackIdx = -1;

      this.pointer.deactivate();

      removeMeshByName(this.scene, "measurementMarker");

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
  /*function Marker(params) {
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
  }*/



  return Measurement;

})();
