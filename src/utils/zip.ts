import { loadAsync } from 'jszip';
import { dirname, resolve, sep } from 'path';
import { promises } from 'fs';

export const extractZip = async (zipBuf: Buffer, destination: string) => {
  const zip = await loadAsync(zipBuf);
  const zipFileKeys = Object.keys(zip.files);
  const rootPath = resolve(destination);

  return Promise.all(
    zipFileKeys.map(async (filename: string) => {
      const entry = zip.files[filename];
      const isFile = !entry.dir;
      const fullPath = resolve(rootPath, filename);
      const inRoot =
        fullPath === rootPath || fullPath.startsWith(rootPath + sep);

      if (!inRoot) {
        return true;
      }

      const directory = (isFile && dirname(fullPath)) || fullPath;
      await promises.mkdir(directory, { recursive: true });
      if (!isFile) return true;
      const data = await entry.async('nodebuffer');
      await promises.writeFile(fullPath, data);
      return true;
    }),
  );
};
