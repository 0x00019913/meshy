MCG.GeometrySet = (function() {

  function GeometrySet(context) {
    this.context = context;

    this.elements = [];

    this.type = MCG.Types.abstractGeometrySet;
  }

  Object.assign(GeometrySet.prototype, {

    add: function(e) {
      if (e.valid()) this.elements.push(e);

      return this;
    },

    count: function() {
      return this.elements.length;
    },

    forEach: function(f) {
      var elements = this.elements;
      var ct = this.elements.length;

      for (var i = 0; i < ct; i++) {
        f(elements[i]);
      }
    },

    filter: function(valid) {
      var result = [];

      this.forEach(function(element) {
        if (valid(element)) result.push(element);
      });

      this.elements = result;

      return this;
    },

    clone: function() {
      var clone = new this.constructor(this.context);
      var elements = clone.elements;

      this.forEach(function(element) {
        elements.push(element.clone());
      });

      return clone;
    }

  });

  return GeometrySet;

})();
