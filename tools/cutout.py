"""Cut a product shoe out of a white studio photo -> transparent PNG.
usage: python tools/cutout.py <in> <out.png> [y0 y1]  (crop band, fraction of height)"""
import sys, cv2, numpy as np

src, dst = sys.argv[1], sys.argv[2]
y0 = float(sys.argv[3]) if len(sys.argv) > 3 else 0.17
y1 = float(sys.argv[4]) if len(sys.argv) > 4 else 0.80
img = cv2.imread(src, cv2.IMREAD_COLOR)
h, w = img.shape[:2]
img = img[int(h * y0):int(h * y1)]
h, w = img.shape[:2]

# grabCut seeded by a rectangle + "definitely background" for near-white pixels at the border
mask = np.full((h, w), cv2.GC_PR_FGD, np.uint8)
m = 6
mask[:m] = mask[-m:] = cv2.GC_BGD
mask[:, :m] = mask[:, -m:] = cv2.GC_BGD
bgd, fgd = np.zeros((1, 65), np.float64), np.zeros((1, 65), np.float64)
cv2.grabCut(img, mask, None, bgd, fgd, 6, cv2.GC_INIT_WITH_MASK)
alpha = np.where((mask == cv2.GC_FGD) | (mask == cv2.GC_PR_FGD), 255, 0).astype(np.uint8)

# keep the biggest blobs only, fill holes, feather the edge
n, lab, stats, _ = cv2.connectedComponentsWithStats(alpha)
keep = np.zeros_like(alpha)
big = sorted(range(1, n), key=lambda i: -stats[i, cv2.CC_STAT_AREA])
for i in big:
    if stats[i, cv2.CC_STAT_AREA] > 0.04 * stats[big[0], cv2.CC_STAT_AREA]:
        keep[lab == i] = 255
mask = cv2.morphologyEx(keep, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

# grabCut keeps the studio shadow and a white rim: in a band along the edge,
# fade out pixels that are close to the white backdrop, then un-mix the white
inner = cv2.erode(mask, np.ones((25, 25), np.uint8))
lum = img.astype(np.float32).min(axis=2)
soft = np.clip((250 - lum) / 22, 0, 1)
a = np.where(inner > 0, 1.0, np.where(mask > 0, soft, 0.0))
a = cv2.GaussianBlur(a.astype(np.float32), (3, 3), 0)
a = np.where(inner > 0, 1.0, a)
f = img.astype(np.float32)
safe = np.maximum(a, 0.05)[..., None]
img = np.clip((f - (1 - safe) * 255) / safe, 0, 255).astype(np.uint8)
alpha = (a * 255).astype(np.uint8)

ys, xs = np.where(alpha > 10)
pad = 8
ya, yb = max(ys.min() - pad, 0), min(ys.max() + pad, h)
xa, xb = max(xs.min() - pad, 0), min(xs.max() + pad, w)
out = np.dstack([img, alpha])[ya:yb, xa:xb]
cv2.imwrite(dst, out)
print(dst, out.shape)
