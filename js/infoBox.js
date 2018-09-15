// infoBox.js
// classes:
//  InfoBox
// description:
//  Hangs out in the corner and provides information.
//  Two types of data displayed:
//   1. mouse-based measurements (updated on click) and
//   2. more static data like mesh parameters.
//  Usage:
//   // for non-manual data
//   var box = new InfoBox();
//   box.add(title, source, props, def;
//   box.update(); // called manually to update the values in the box
//   // for measurements
//   box.showMeasurementOutput();
//   box.showMeasurement(m); // m is an object { key:val, ... }
//   box.hideMeasurementOutput(); // when measurement turns off
//
//  Arguments for .add:
//   -title: title for the line in the info box
//   -source: closest unchanging reference to the requisite property
//   -props: a single property name, or an array of property names, that
//     lead to the data source
//   -def: default value if the line needs to be calculated
//
//  Prop names that are functions are called instead of dereferenced,
//   but this can be expensive.
//
//  Examples:
//   -If the requisite property is one reference away from the source, do:
//     box.add("foo", this, "count"); // or box.add("foo", this, ["count"]);
//   Then the value displayed will be this.count.
//   -If the datum comes from this.model.count, and model is not guaranteed
//   to reference the same object, then .add is called like:
//     box.add("foo", this, ["model", "count"]);
//   When calling .update(), the value displayed in the infobox will show
//   the value of this.model.count.


var InfoBox = (function() {

  // container for info lists
  function InfoBox(domElement, decimals) {
    domElement = domElement || document;

    this.div = document.createElement("div");
    this.div.id = "infobox"
    this.styleDiv();
    document.body.appendChild(this.div);

    this.lists = {};

    this.addList("default");

    this.decimals = decimals !== undefined ? decimals : 4;
  }

  InfoBox.Colors = {
    color0: "transparent",
    color1: "#8adeff",
    color2: "#ffff00"
  }

  Object.assign(InfoBox.prototype, {

    // update all lists
    update: function() {
      for (var listName in this.lists) {
        this.lists[listName].update();
      }
    },

    // add a list to the InfoBox
    addList: function(name, color) {
      if (this.lists.hasOwnProperty(name)) return null;

      var list = new InfoList(name, color);

      list.parent = this;
      this.lists[name] = list;
      this.div.appendChild(list.ul);

      return list;
    },

    // remove a list from the InfoBox
    removeList: function(list) {
      // never remove the default list
      if (list.name === "default") return;

      // do nothing if the list isn't in the box
      if (!this.lists.hasOwnProperty(list.name)) return;

      // remove the HTML node
      this.div.removeChild(list.ul);

      // remove the lists entry
      delete this.lists[list.name];
    },

    // adding a line to the InfoBox adds it to the default list
    add: function(title, source, props, def) {
      this.lists.default.add(title, source, props, def);
    },

    // Style the div container.
    styleDiv: function() {
      this.div.style.position = "absolute";
      this.div.style.left = "0";
      this.div.style.top = "0";
      this.div.style.width = "255px";
      this.div.style.marginLeft = "15px";
      this.div.style.backgroundColor = "#000";

      this.div.style.color = "#eee";
      this.div.style.font = "11px Lucida Grande, sans-serif";
      this.div.style.textShadow = "0 -1px 0 #111";
    }

  });



  // a list that goes into the InfoBox
  function InfoList(name, color) {
    if (!name) return;

    this.name = name;
    this.ul = document.createElement("ul");
    this.styleUL(color);

    this.items = [];
  }

  Object.assign(InfoList.prototype, {
    // Add a line.
    add: function(title, source, props, def) {
      var liValueElement = this.createLine(title);

      if (!isArray(props)){
        props = [props];
      }

      this.items.push({
        element: liValueElement,
        source: source,
        props: props,
        def: def
      });
    },

    // Creates a line in the InfoList, returns HTML element that contains the value.
    createLine: function(title) {
      var li = document.createElement("li");
      this.styleLI(li);

      var liTitle = document.createElement("span");
      this.styleLITitle(liTitle);
      var liTitleText = document.createTextNode(title);
      liTitle.appendChild(liTitleText);

      li.appendChild(liTitle);

      var liValue = document.createElement("span");
      this.styleLIValue(liValue);

      li.appendChild(liValue);

      this.ul.appendChild(li);

      return liValue;
    },

    // Update the gettable values (like mesh bounds).
    update: function() {
      for (var itemIdx=0; itemIdx<this.items.length; itemIdx++) {
        var item = this.items[itemIdx];

        if (!item.source) {
          item.element.textContent = "";
          continue;
        }

        var value = this.getPropValue(item.source, item.props);

        if (value==="" && item.def) value = item.def;

        item.element.textContent = value;
      }
    },

    // Format numerical quantities; if int, return as-is.
    formatNumber: function(num) {
      if ((num%1)===0) return num;
      else return +num.toFixed(this.parent.decimals);
    },

    // Get the value of a prop as mapped through .add or .addMultiple.
    getPropValue: function(source, propPath) {
      for (var i=0; i<propPath.length; i++) {
        if (isFunction(source[propPath[i]])) source = source[propPath[i]]();
        else source = source[propPath[i]];
        if (source===null || source===undefined) return "";
      }
      var value;

      if (isNumber(source)) value = this.formatNumber(source);
      else if (source.isVector2) {
        value = "[";
        value += this.formatNumber(source.x);
        value += ", ";
        value += this.formatNumber(source.y);
        value += "]";
      }
      else if (source.isVector3) {
        value = "[";
        value += this.formatNumber(source.x);
        value += ", ";
        value += this.formatNumber(source.y);
        value += ", ";
        value += this.formatNumber(source.z);
        value += "]";
      }
      else value = source;

      return value;
    },

    styleUL: function(color) {
      this.ul.style.boxSizing = "border-box";
      this.ul.style.width = "100%";
      this.ul.style.height = "auto";
      this.ul.style.margin = "0";
      this.ul.style.padding = "0";
      if (color !== undefined) this.ul.style.border = "1px solid " + color;
    },

    // Style list item.
    styleLI: function(listItem) {
      listItem.style.width = "100%";
      listItem.style.minHeight = "21px";
      //listItem.style.lineHeight = "27px";
      listItem.style.overflow = "hidden";
      listItem.style.padding = "5px 4px 0 4px";
      //listItem.style.borderBottom = "1px solid #2c2c2c";
    },

    // Style the span containing the title of a list item.
    styleLITitle: function(listItemTitle) {
      listItemTitle.style.width = "40%";
      listItemTitle.style.overflow = "hidden";
      listItemTitle.style.textOverflow = "ellipsis";
      listItemTitle.style.display = "inline-block";
      listItemTitle.style.verticalAlign = "top";
    },

    // Style the span containing the value of a list item.
    styleLIValue: function(listItemTitle) {
      listItemTitle.style.width = "60%";
      listItemTitle.style.overflow = "hidden";
      listItemTitle.style.textOverflow = "ellipsis";
      listItemTitle.style.display = "inline-block";
    }

  });

  return InfoBox;

})();
