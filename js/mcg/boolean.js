MCG.Boolean = (function() {

  var Boolean = {
    union: union
  };

  function union(a) {
    return MCG.Sweep.sweep(a);
  }


  return Boolean;

})();
