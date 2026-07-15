# Repository instructions

## Backend deployment images

- The backend does not use `torchvision` or `torchaudio`.
- Every backend Dockerfile must run the following command after all Python
  package installation steps and before its final runtime command:

  ```dockerfile
  RUN python -m pip uninstall -y torchvision torchaudio \
      && python -m pip check
  ```

- Do not add either package to backend requirements unless the application is
  deliberately changed to use it and its version is pinned to the installed
  PyTorch/CUDA stack.
- Do not rely on uninstalling these packages in a Kubernetes startup command;
  bake their removal into the image so the image is reproducible.
