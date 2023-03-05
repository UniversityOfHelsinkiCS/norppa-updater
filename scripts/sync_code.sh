#!/bin/bash

# Check if an argument was provided
if [ -z "$1" ]; then
  echo "Error: You must provide a path to a folder as an argument."
  exit 1
fi

# Check if the provided argument is a directory
if [ ! -d "$1" ]; then
  echo "Error: The provided argument must be a path to a directory."
  exit 1
fi

# Copy the contents of the "models" and "migrations" subfolders to the corresponding subfolders under the current directory
cp -R "$1/src/server/models/." "./src/models/"
cp -R "$1/src/server/migrations/." "./src/migrations/"

echo "Done."
