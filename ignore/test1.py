import cv2
import os

os.makedirs("dataset", exist_ok=True)

cap = cv2.VideoCapture(1, cv2.CAP_DSHOW)
cap.set(cv2.CAP_PROP_FRAME_WIDTH, 1920)
cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 1080)
cap.set(cv2.CAP_PROP_AUTOFOCUS, 0)
# cap.set(cv2.CAP_PROP_ZOOM, 1.5)
cap.set(cv2.CAP_PROP_FOCUS, 2085)
cap.set(cv2.CAP_PROP_AUTO_WB, 0)
#2783
#2.9->1159
cap.set(cv2.CAP_PROP_AUTO_EXPOSURE, 0.25)  # manual
cap.set(cv2.CAP_PROP_EXPOSURE, -7)         # shorter exposure
cap.set(cv2.CAP_PROP_GAIN, 5)              # compensate brightness


i = 0
while True:
    ret, frame = cap.read()
    if not ret:
        break

    cv2.imshow("AFDM412", frame)

    key = cv2.waitKey(1)
    if key == ord('c'):
        # cv2.imshow("Captured Frame", frame)
        # cv2.waitKey(1)

        filename = input("Enter filename (without extension): ").strip()
        if filename:
            path = f"dataset/{filename}.jpg"
            cv2.imwrite(path, frame)
            print("Saved:", path)
        else:
            print("Filename empty, not saved")
    # if key == ord('c'):
    #     filename = f"dataset/img_{i:04d}.jpg"
    #     cv2.imwrite(filename, frame)
    #     print("Saved", filename)
        i += 1
    elif key == 27:  # ESC
        break

cap.release()
cv2.destroyAllWindows()
