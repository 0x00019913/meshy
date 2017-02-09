function Transform(op, axis, amount, model) {
  if (!model) {
    this.op = "noop";
    this.reason = "Model doesn't exist."
    return this;
  }
  this.model = model;
  this.dynamic = false;
  switch (op) {
    case "floor":
      this.op = "translate";
      this.axis = axis;
      if (axis=="all") {
        this.amount = [-1*model.xmin, -1*model.ymin, -1*model.zmin];
      }
      else {
        this.amount = -1 * model[axis+"min"];
      }
      break;
    case "center":
      this.op = "translate";
      this.axis = axis;
      if (axis=="all") {
        this.amount = [-1*model.getCenterx(), -1*model.getCentery(), -1*model.getCenterz()];
      }
      else {
        this.amount = -1 * model["getCenter"+axis]();
      }
      break;
    case "translate":
      this.op = "translate";
      this.axis = axis;
      this.amount = amount;
      break;
    case "rotate":
      this.op = "rotate";
      this.axis = axis;
      this.amount = amount;
      break;
    case "toggleWireframe":
      this.op = "toggleWireframe";
      break;
  }
  return this;
}

Transform.prototype = {
  constructor: Transform,

  makeInverse: function() {
    if (this.op=="noop") return null;
    var amount;
    if (this.axis=="all") {
      amount = [-1*this.amount[0], -1*this.amount[1], -1*this.amount[2]]
    }
    else {
      amount = -1*this.amount;
    }
    var inv = new this.constructor(this.op, this.axis, amount, this.model);
    inv.inverse = true;
    return inv;
  },

  apply: function() {
    switch (this.op) {
      case "noop":
        console.log("Error: no-op. Reason: ", this.reason);
        return;
      case "translate":
        if (this.axis=="all") {
          this.model.translate("x", this.amount[0]);
          this.model.translate("y", this.amount[1]);
          this.model.translate("z", this.amount[2]);
        }
        else {
          this.model.translate(this.axis, this.amount);
        }
        break;
      case "rotate":
        if (this.axis=="all") {
          // apply in reverse order if inverting rotation
          var axisOrder = this.inverse ? ["z","y","x"] : ["x","y","z"];
          this.model.rotate(axisOrder[0], this.amount[0]);
          this.model.rotate(axisOrder[1], this.amount[1]);
          this.model.rotate(axisOrder[2], this.amount[2]);
        }
        else {
          this.model.rotate(this.axis, this.amount);
        }
        break;
      case "toggleWireframe":
        this.model.toggleWireframe();
        break;
    }
  },

  /* Intended pattern for dynamic updates (not using because updating in
      real time in WebGL is slow for large meshes):
    // in UI setup
    this.xOffset = 0;
    this.xOffsetPrev = this.xOffset;
    translationFolder.add(this, "xOffset", -50, 50).onChange(this.translateXDynamic.bind(this).onFinishChange(this.endTranslateXDynamic.bind(this));
    ...
    // functions
    this.translateXDynamic = function() {
      if (!this.translationXDynamic) {
        this.translationXDynamic = new Transform("translate","x",0,this.model);
        this.translationXDynamic.setDynamicStart(this.xOffsetPrev);
      }
      var delta = this.xOffset - this.xOffsetPrev;
      this.translationXDynamic.setAmount(delta);
      this.translationXDynamic.apply();

      console.log(this);

      this.xOffsetPrev = this.xOffset;
    }
    this.endTranslateXDynamic = function() {
      this.undoStack.push(this.translationXDynamic.makeInverse());
      this.xOffsetPrev = this.xOffset;
      this.translationXDynamic = null;
    }
  */

  setDynamicStart: function(start) {
    this.dynamic = true;
    this.start = start;
  },

  setAmount: function(amount) {
    this.amount = amount;
  }

}

function UndoStack() {
  // stack of inverse transformations
  this.history = []
}

UndoStack.prototype = {
  constructor: UndoStack,

  undo: function() {
    if (this.history.length==0) {
      console.log("No more undo history available.");
      return;
    }
    var inv = this.history.pop();
    inv.apply();
  },

  push: function(inv) {
    if (inv) this.history.push(inv);
  },

  clear: function() {
    this.history = [];
  }
}
