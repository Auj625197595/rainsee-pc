declare const process: NodeJS.Process & {
  electronBinding?: (name: string) => any;
  _linkedBinding?: (name: string) => any;
};

const getFeaturesBinding = () => {
  try {
    if (typeof process._linkedBinding === 'function') {
      return process._linkedBinding('electron_common_features');
    }

    if (typeof process.electronBinding === 'function') {
      return process.electronBinding('features');
    }
  } catch (e) {
    return null;
  }

  return null;
};

const features = getFeaturesBinding();

if (features && typeof features.isViewApiEnabled !== 'function') {
  features.isViewApiEnabled = () => true;
}
