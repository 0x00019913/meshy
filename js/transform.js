/* transform.js
   classes:
    Transform
    EditStack
   description:
    A class representing a transformation. Has a reference to a model and can
    apply the appropriate transformation with .apply(). Has a method to generate
    an inverse transformation, which can be pushed onto an instance of
    EditStack.
*/

function Transform(name, start) {
  this.name = name;

  // start and end value of transformed parameter
  this.startVal = start.clone();
  this.endVal = null;

  // functions called on transform application and transform end
  this.onApply = null;
  this.onEnd = null;

  // true if this transform can be applied in reverse
  var invertible = true;
  Object.defineProperty(this, "invertible", {
    get: function() { return invertible; },
    set: function(inv) { if (inv !== undefined) invertible = !!inv; }
  });
}

Object.assign(Transform.prototype, {

  constructor: Transform,

  // true if start value and end value are the same
  noop: function() {
    if (this.startVal === null || this.endVal === null) return false;
    return this.startVal.equals(this.endVal);
  },

  apply: function(val) {
    // if ending value is given, record it
    if (val !== undefined) this.endVal = val.clone();

    // apply with current end value
    if (this.onApply) this.onApply(this.endVal);

    return this;
  },

  applyInverse: function() {
    if (this.onApply) this.onApply(this.startVal);
  },

  end: function() {
    if (this.onEnd) this.onEnd();

    return this;
  }

});

// Constructor - initialized with a printout object.
function EditStack() {
  // stack of transformations
  this.history = [];
  this.pos = -1
}

EditStack.prototype = {
  constructor: EditStack,

  // Get the inverse transform at current positition and apply it.
  undo: function() {
    if (this.pos < 0) {
      throw "No undo history available.";
    }

    var entry = this.history[this.pos--];

    // apply inverse
    entry.transform.applyInverse();
    entry.transform.end();

    // if update function exists, call it
    if (entry.onTransform) entry.onTransform();
  },

  // Get the transform at the next position and apply it.
  redo: function() {
    if (this.pos >= this.history.length-1) {
      throw "No redo history available.";
    }

    var entry = this.history[++this.pos];

    // apply the transform and update function if given
    entry.transform.apply();
    entry.transform.end();

    // if update function exists, call it
    if (entry.onTransform) entry.onTransform();
  },

  // Put a new transform onto the stack.
  push: function(transform, onTransform) {
    if (this.pos < this.history.length - 1) {
      // effectively deletes all entries after this.pos
      this.history.length = this.pos + 1;
    }
    if (transform) this.history.push({
      transform: transform,
      onTransform: onTransform || null
    });
    this.pos++;
  },

  // Clear the stack.
  clear: function() {
    this.history.length = 0;
    this.pos = -1;
  }
}
