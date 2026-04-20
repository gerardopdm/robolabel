import argparse
import cv2
import numpy as np

WINDOW = "Deteccion de tejas"


def detectar_tejas(
    img,
    thresh_l,
    kernel_size,
    dist_pct,
    min_area,
    min_box_w,
    min_box_h,
    box_scale_w_pct,
    box_scale_h_pct,
):
    """
    kernel_size debe ser impar >= 3.
    dist_pct: porcentaje del max del distance transform (ej. 40 -> 0.4 * max).
    box_scale_*: 100 = tamaño natural del contorno; >100 agranda, <100 achica (desde el centro).
    """
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, _, _ = cv2.split(lab)

    _, thresh = cv2.threshold(l, thresh_l, 255, cv2.THRESH_BINARY)

    k = max(3, kernel_size | 1)
    kernel = np.ones((k, k), np.uint8)
    opening = cv2.morphologyEx(thresh, cv2.MORPH_OPEN, kernel, iterations=1)

    dist_transform = cv2.distanceTransform(opening, cv2.DIST_L2, 5)
    factor = max(1, min(99, dist_pct)) / 100.0
    _, sure_fg = cv2.threshold(dist_transform, factor * dist_transform.max(), 255, 0)
    sure_fg = np.uint8(sure_fg)

    contours, _ = cv2.findContours(sure_fg, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    h_img, w_img = img.shape[:2]
    output = img.copy()
    count = 0
    sw = max(10, min(300, box_scale_w_pct)) / 100.0
    sh = max(10, min(300, box_scale_h_pct)) / 100.0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area <= min_area:
            continue
        x, y, w, h = cv2.boundingRect(cnt)
        if w < min_box_w or h < min_box_h:
            continue

        cx = x + w * 0.5
        cy = y + h * 0.5
        nw = int(round(w * sw))
        nh = int(round(h * sh))
        x1 = int(round(cx - nw * 0.5))
        y1 = int(round(cy - nh * 0.5))
        x2 = x1 + nw
        y2 = y1 + nh

        x1 = max(0, min(x1, w_img - 1))
        y1 = max(0, min(y1, h_img - 1))
        x2 = max(x1 + 1, min(x2, w_img))
        y2 = max(y1 + 1, min(y2, h_img))

        count += 1
        cv2.rectangle(output, (x1, y1), (x2, y2), (0, 255, 0), 2)
        cv2.putText(
            output,
            f"#{count}",
            (x1, max(15, y1 - 8)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (0, 255, 0),
            2,
        )

    return output, count


def main():
    parser = argparse.ArgumentParser(
        description="Deteccion de tejas con parametros ajustables (sliders)."
    )
    parser.add_argument(
        "imagen",
        nargs="?",
        default="tejas1.jpg",
        help="Ruta de la imagen a procesar (BGR).",
    )
    args = parser.parse_args()

    img = cv2.imread(args.imagen)
    if img is None:
        raise SystemExit(f"No se pudo cargar la imagen: {args.imagen}")

    cv2.namedWindow(WINDOW, cv2.WINDOW_AUTOSIZE)

    def tb(name, value, max_v):
        cv2.createTrackbar(name, WINDOW, value, max_v, lambda _: None)

    tb("Umbral L", 160, 255)
    tb("Kernel (2n+1) n", 2, 15)
    tb("Dist %% del max", 40, 99)
    tb("Area minima", 500, 8000)
    tb("Min ancho box", 0, 400)
    tb("Min alto box", 0, 400)
    tb("Escala ancho %%", 100, 300)
    tb("Escala alto %%", 100, 300)

    while True:
        t_l = cv2.getTrackbarPos("Umbral L", WINDOW)
        n_k = cv2.getTrackbarPos("Kernel (2n+1) n", WINDOW)
        dist_p = cv2.getTrackbarPos("Dist %% del max", WINDOW)
        a_min = cv2.getTrackbarPos("Area minima", WINDOW)
        mw = cv2.getTrackbarPos("Min ancho box", WINDOW)
        mh = cv2.getTrackbarPos("Min alto box", WINDOW)
        swp = cv2.getTrackbarPos("Escala ancho %%", WINDOW)
        shp = cv2.getTrackbarPos("Escala alto %%", WINDOW)

        kernel_size = 2 * max(1, n_k) + 1
        resultado, total = detectar_tejas(
            img,
            max(1, t_l),
            kernel_size,
            max(1, dist_p),
            a_min,
            mw,
            mh,
            max(10, swp),
            max(10, shp),
        )

        cv2.imshow(WINDOW, resultado)
        cv2.setWindowTitle(WINDOW, f"Deteccion: {total} tejas | {args.imagen}")

        key = cv2.waitKey(30) & 0xFF
        if key in (27, ord("q")):
            break

    cv2.destroyAllWindows()


if __name__ == "__main__":
    main()
