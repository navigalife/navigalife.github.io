const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

const assertImage = (file) => {
  if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Choose a JPEG, PNG, or WebP image.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error(`${file.name} is larger than 20 MB.`);
  }
};

const canvasBlob = (canvas, quality = 0.86) => new Promise((resolve, reject) => {
  canvas.toBlob((blob) => {
    if (blob) resolve(blob);
    else reject(new Error('This browser could not encode the image.'));
  }, 'image/webp', quality);
});

export const resizeProductImage = async (file) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, 1600 / Math.max(image.width, image.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.width * scale));
  canvas.height = Math.max(1, Math.round(image.height * scale));
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#F6F4EF';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  image.close();
  return canvasBlob(canvas);
};

export const cropEvidenceImage = async (file, label) => {
  assertImage(file);
  const image = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const dialog = document.querySelector('#crop-dialog');
  const canvas = document.querySelector('#crop-canvas');
  const zoom = document.querySelector('#crop-zoom');
  const positionX = document.querySelector('#crop-x');
  const positionY = document.querySelector('#crop-y');
  document.querySelector('#crop-title').textContent = `Crop ${label} image`;
  zoom.value = '1';
  positionX.value = '0';
  positionY.value = '0';

  const draw = () => {
    const context = canvas.getContext('2d', { alpha: false });
    const coverScale = Math.max(canvas.width / image.width, canvas.height / image.height);
    const scale = coverScale * Number(zoom.value);
    const width = image.width * scale;
    const height = image.height * scale;
    const overflowX = Math.max(0, width - canvas.width);
    const overflowY = Math.max(0, height - canvas.height);
    const x = -(overflowX / 2) + (Number(positionX.value) * overflowX / 2);
    const y = -(overflowY / 2) + (Number(positionY.value) * overflowY / 2);
    context.fillStyle = '#F6F4EF';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, x, y, width, height);
  };
  const update = () => draw();
  zoom.addEventListener('input', update);
  positionX.addEventListener('input', update);
  positionY.addEventListener('input', update);
  draw();

  const accepted = await new Promise((resolve) => {
    const close = () => resolve(dialog.returnValue === 'default');
    dialog.addEventListener('close', close, { once: true });
    dialog.showModal();
  });
  zoom.removeEventListener('input', update);
  positionX.removeEventListener('input', update);
  positionY.removeEventListener('input', update);
  image.close();
  if (!accepted) return null;
  return canvasBlob(canvas, 0.88);
};

export const blobToBase64 = (blob) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.addEventListener('load', () => resolve(String(reader.result).split(',')[1]));
  reader.addEventListener('error', () => reject(new Error('The processed image could not be read.')));
  reader.readAsDataURL(blob);
});
