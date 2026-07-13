import cv2
import numpy as np

def detect_c_defect(image_path, debug=False):
    img = cv2.imread(image_path)
    orig = img.copy()

    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    blur = cv2.GaussianBlur(gray, (5,5), 0)

    # --- STEP 1: Robust Binary Mask ---
    _, thresh = cv2.threshold(
        blur, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU
    )

    # invert if blade is white
    if np.mean(thresh) > 127:
        thresh = 255 - thresh

    # clean mask
    kernel = np.ones((5,5), np.uint8)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_CLOSE, kernel, iterations=2)
    thresh = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

    # --- STEP 2: Contour ---
    contours, _ = cv2.findContours(
        thresh, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE
    )

    if len(contours) == 0:
        return False, 0, None

    cnt = max(contours, key=cv2.contourArea)

    # smooth contour (VERY IMPORTANT)
    epsilon = 0.002 * cv2.arcLength(cnt, True)
    cnt = cv2.approxPolyDP(cnt, epsilon, True)

    # --- STEP 3: Convexity Defects ---
    hull = cv2.convexHull(cnt, returnPoints=False)

    if hull is None or len(hull) < 4:
        return False, 0, None

    defects = cv2.convexityDefects(cnt, hull)

    if defects is None:
        return False, 0, None

    max_depth = 0
    defect_point = None

    # --- STEP 4: Filter defects ---
    for i in range(defects.shape[0]):
        s, e, f, d = defects[i][0]

        start = cnt[s][0]
        end   = cnt[e][0]
        far   = cnt[f][0]

        depth = d / 256.0

        # --- angle check (ensures C shape) ---
        a = np.linalg.norm(end - start)
        b = np.linalg.norm(far - start)
        c = np.linalg.norm(end - far)

        if b * c == 0:
            continue

        angle = np.arccos((b*b + c*c - a*a) / (2*b*c))
        angle_deg = np.degrees(angle)

        # --- CONDITION FOR C DEFECT ---
        if depth > 12 and 30 < angle_deg < 120:
            if depth > max_depth:
                max_depth = depth
                defect_point = tuple(far)

            if debug:
                cv2.circle(orig, tuple(far), 6, (0,0,255), -1)
                cv2.line(orig, tuple(start), tuple(end), (0,255,0), 2)

    defect_found = max_depth > 12

    if debug:
        cv2.imshow("mask", thresh)
        cv2.imshow("result", orig)
        cv2.waitKey(0)

    return defect_found, max_depth, defect_point

result, depth, point = detect_c_defect("cropped.png", debug=False)

print("C-defect:", result)
print("Depth:", depth)
print("Location:", point)