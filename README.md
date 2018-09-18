# Documentation:

`Meshy` is my browser-based tool for performing measurements, transformations, visualizations, repair, and slicing on polygonal meshes, intended to make life easier for 3D printing folks. This post presents a comprehensive guide to all current features of the tool.

> Everything is under development: slicer improvements and additional features (better G-code exporter, more infill types), a better repair algorithm, UI improvements, more import formats.

# Requirements

A computer with a GPU and a browser capable of running WebGL, with Javascript enabled. Tested and works in the latest releases of Chrome and Firefox on Ubuntu and Windows. Appears to work in Opera, though it's wise to turn off mouse gestures if panning with RMB.

# General use

The user can upload a mesh. At any given time, the tool can contain one mesh (the mesh can be comprised of multiple islands, but the geometry must all come from one file). The user can perform standard transformations (translations, rotations, scaling, floor, center, mirror), use any of `meshy`'s calculation, measurement, and repair tools, slice the mesh, export the mesh, and change some viewport settings. The user can delete the mesh and then upload another.

# Interface and controls

The main viewport uses mouse and keyboard controls:

* left-click and drag to rotate the camera
* scroll wheel to zoom
* MMB/RMB to pan
* `ctrl+i` to import a mesh
* `f` to center the camera on the mesh
* `g` toggles the gizmo
* `c` toggles the center-of-mass indicator
* `w` toggles wireframe
* `b` toggles build volume visibility
* `ctrl+z` to undo
* `ctrl+y` or `ctrl+shift+z` to redo
* `esc` to turn off the cursor (used for measurements and setting the mesh base)

The information box on the top left indicates computed quantities.

The dat.GUI box on the top right contains the user-interactive components.

The axis widget indicates the camera orientation. The outward-facing vector from a face of the cube points along the axis shown on the face.

The printout area next to the axis widget indicates status changes, events, and warnings.

# Gizmo

The gizmo is anchored at the current position of the mesh. Toggle its visibility with `g`.

The gizmo can scale, rotate, and translate the mesh. The colored handles indicate axis-oriented transformations; the white handles indicate transformation in the viewing plane:

* the white rotation handle rotates around a vector normal to the viewing plane
* the white chevrons translate in the viewing plane, though the mesh will be constrained to make contact with the build plate if the `Edit -> Snap to floor` box is checked
* the white sphere scales uniformly

`ctrl` will force transformations to happen in increments (15 degrees for rotations, 1 unit for translations, powers of 2 for scaling).

Regarding world space vs. object space: scaling occurs in object space, so the scaling handles will rotate to match the object-space axes. General scaling in world space is disallowed. The rotation handles, however, will not rotate to facilitate intuitive rotation on world axes.

# Import

Supported file formats are OBJ and STL (binary and ASCII). There appears to be a rough upper limit of 50-80MB on the upload size, which is in the neighborhood of what you'd use for 3D printing. I've been able to load meshes with around 1-2 million polygons. It depends on your browser and computer. If the page hangs, the file's too big.

`Meshy` uses Three.js importers.

# Import Settings

## Import units

Common file formats don't specify units, while `meshy` uses millimeters as its internal units. Use this field to specify the units of one unit of length in the imported file, which will then be converted to millimeters.

## Autocenter

If checked, automatically center the mesh and floor it to the build plate.

# Export

The user can specify a filename and export as either OBJ or STL (`exportSTL` exports as binary STL, `exportSTLascii` exports as ASCII STL).

OBJ files will export a list of vertices and a list of triangles. Quads are not preserved; neither are normals nor UVs. None of these are typically required for 3D printing. I may change this in the future.

# Settings

## Little endian

Affects how the exporter writes files.

## Vertex precision

Generally determines the conversion factor between floating-point and fixed-point coordinates and specifies the number of digits in the float values exported in ASCII files.

# Display

## Display precision

The number of decimal places shown in the infobox and number controllers.

## Toggles

* gizmo
* axis widget
* wireframe
* center of mass indicator

## Background color

In my experience, this is best left alone.

## Material options

* mesh color
* mesh roughness
* mesh metalness
* wireframe color

## Build Volume

### Toggle volume

Toggles build volume visibility.

### Center origin

The coordinate system origin is typically in a corner of the build volume. Check this to put it in the center instead.

### Build volume dimensions

The dimensions of the build volume in millimeters.

# Edit

Functions that modify the mesh.

## Snap to floor

Checked if all transformations force the mesh to make contact with the build plate. True by default.

## Set base

Activates the pointer. Click on any part of the mesh to orient it in such a way that the target polygon faces downward. Helps orient the mesh in such a way that a flat base touches the floor. Can be turned off at any time with `esc`.

## Autocenter

Automatically center the mesh and floor it to the build plate.

## Translate

Self-explanatory.

## Rotate

Values are given in degrees, normalized to the `[0, 360)` range. Rotations are performed before translations.

This folder uses Euler angles in XYZ order relative to the mesh's original position in object space. Because Euler angles can yield unintuitive results, I recommend using the gizmo instead.

## Scale

Scaling is performed with respect to the current mesh position. Scaling happens before rotation. `Meshy` has the following modes of scaling:

### Scale by factor

Scale the mesh by a given factor on the given axis.

### Scale to size

Scale the mesh uniformly such that it attains the correct size on the given axis.

### Scale to measurement

If a measurement is active, this folder will contain a selection box - use this to select one of the measured values. Change the value to scale the mesh such that the measurement now equals the given value.

### Scale to ring size

Start a circle measurement and mark a circle around the ring's inner periphery. Select a size and scale: `meshy` will scale the ring to have the correct inner diameter. The ring sizes and their respective measurements are given according to the US, Canada, and Mexico standard <a href="https://en.wikipedia.org/wiki/Ring_size">as specified on Wikipedia</a>.

*NB: the new diameter will be in millimeters.* E.g., size 9.5 corresponds to an inner diameter of 19.35mm, so the diameter will now measure 19.35mm. Make sure your printer/printing service is aware of this.

I advise ending the circle measurement after scaling because the pointer code does raycasting at every frame, which is computationally costly and can cause lag.

## Mirror

Mirror the mesh in object space.

## Floor

Translate the mesh along the given axis such that its lowest bound is at 0 on that axis.

## Center

Center the mesh in the current build volume.

## Flip normals

Self-explanatory.

# Measurement

Measurement is performed thusly:

* activate the desired measurement
* left-click the model to place markers
* once the necessary number of markers has been placed, the result of the measurement shows up in the infobox
* placing more markers performs the measurement again, replacing old markers on a FIFO (first in, first out) basis

`Meshy` has the following modes of measurement:

## Length

Takes 2 markers; measures the Euclidean distance between the markers.

## Angle

Takes 3 markers; measures the angle between two segments formed between them in degrees.

## Circle

Takes 3 markers, which identify a circle in 3-space; measures radius, diameter, circumference, and area.

## Cross-section

Takes 1 marker; measures the cross-section in the plane normal (perpendicular) to the given axis. Calculates total area, contour length, and the bounding box.

Note that this measurement is deactivated by rotating but can be safely scaled and translated.

## Local cross-section

Takes 3 markers that denote a path around a particular part of the mesh. The 3 markers subtend a plane that cuts some number of contours through the mesh; `meshy` infers which of these contours is closest to the markers and selects that one. Calculates the same values as the regular axis-aligned cross-section.

# Mesh Thickness

Visualizes approximate mesh thickness below the specified threshold. This is done by casting a ray along each face's negative normal and measuring the distance it travels before hitting the inside of the mesh.

Any part of the mesh that's below the threshold `t` is shown in red, interpolated linearly from full white to full red over the `[t, 0]` interval.

(NB: consulting the original paper that prompted this method - "Consistent Mesh Partitioning and Skeletonisation using the Shape Diameter Function" - one will see that the SDF is canonically calculated by casting 30 rays in a wide cone; however, I settled for only casting one ray because this is already quite expensive to do in a non-parallel way. One ray provides a poor approximation, but it should nonetheless give a fair idea of where the mesh is thin.)

Possible alternatives to this method, which I may implement eventually:

1. use the full SDF (30 rays in a 120-degree cone) over a randomly picked set of faces, then interpolate the SDF over the remaining surface, and
2. remesh the model to a much lower resolution such that the polygon distribution is more or less even (presumably via the octree) and details are preserved, then do the full SDF over the new model's faces; this seems to vaguely describe Shapeways's internal algorithm and makes a lot of sense to me.

# IT'S LATE AT THE TIME OF WRITING, SO EVERYTHING FROM HERE ON IS TODO

# Repair (beta)

Patches holes surrounded by loops of edges that each border one triangle. First, generate the patch with `generatePatch`, which will fill in holes with preview (green) geometry. Then either accept it to integrate it into the model or cancel the patch. This is not undoable.

This algorithm is new and may throw errors (or just fail to patch something). Do let me know via email (0x00019913@gmail.com) or <a href="https://github.com/0x00019913/meshy">on the repo</a> and send me the model in question.

For a broad overview of how it works, see "A robust hole-filling algorithm for triangular mesh", Zhao, Gao, Lin, 2007.

# Slice

At the time of writing, the slicing functionality is rudimentary - the mesh is sliced along one particular plane, with everything above the plane hidden. TODO in the very near future: triangulate the hole and make slices over the entire mesh, exporting them as G-code.

# Undo

*Only the actions under the Transform folder are undoable.* This is because 1. the memory limitations of the typical browser make a more robust undo stack not generally feasible and 2. the sequence of actions performed in `meshy` would, by and large, be minimal and easily replicated in case of a faux pas.

`ctrl+Z` triggers the undo.

# Redo

`ctrl+y` and `ctrl+shift+z` trigger the redo.

# Delete

This action is not undoable. It removes all geometry data from the current state, allowing the user to import another mesh.
