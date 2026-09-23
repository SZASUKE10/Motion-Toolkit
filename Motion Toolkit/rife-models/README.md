# RIFE interpolation models

The PLAY button (client/js/modules/playback.js -> host/python/rife_runner.py)
uses a pruned-RIFE checkpoint. The weights are NOT committed to this repo
(they're hundreds of MB), so the folder stays empty until you add them:

1. Download Practical-RIFE v4.x (the public lineage of the NVIDIA v4.0
   model; pick the newest release that ships `flownet.pkl` + `IFNet_HDv3.py`):
   https://github.com/megvii-research/Practical-RIFE/releases

2. Create a folder here named exactly `rife-nvidia-4.0` (this is the key in
   client/js/lib/depth-config.js's RIFE_MODELS list) and copy the release's
   `train_log` contents into it, e.g.:

       rife-models/
         rife-nvidia-4.0/
           flownet.pkl        <- weights
           IFNet_HDv3.py      <- network code rife_runner.py imports
           raft.py            <- imported by IFNet_HDv3.py in some releases
           ...

   Alternatively set the RIFE_MODELS_DIR environment variable to point the
   runner at a shared folder elsewhere on disk.

Transparency note: no released RIFE version interpolates alpha channels.
rife_runner.py works around this by interpolating RGB only and re-attaching
the nearest source frame's alpha to every output frame, so footage with
transparency keeps its matte through the whole interpolated sequence.

To use a different checkpoint, add a matching entry to RIFE_MODELS in
client/js/lib/depth-config.js and a folder of the same name beside this one.
