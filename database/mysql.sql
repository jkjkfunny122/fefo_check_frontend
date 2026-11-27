CREATE DATABASE IF NOT EXISTS stocklot_fefo
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE stocklot_fefo;

CREATE TABLE IF NOT EXISTS products (
    product_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    barcode VARCHAR(64) NOT NULL,
    product_name VARCHAR(255) NOT NULL,
    items_per_box INT UNSIGNED NOT NULL DEFAULT 1,
    unit_name VARCHAR(50) NOT NULL DEFAULT 'ชิ้น',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    PRIMARY KEY (product_id),
    UNIQUE KEY uq_products_barcode (barcode),
    CONSTRAINT chk_products_items_per_box CHECK (items_per_box > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_lots (
    lot_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    product_id BIGINT UNSIGNED NOT NULL,
    lot_code VARCHAR(100) NULL,
    receive_date DATE NOT NULL,
    expiry_date DATE NOT NULL,
    boxes INT UNSIGNED NOT NULL,
    items_per_box INT UNSIGNED NOT NULL,
    received_qty BIGINT UNSIGNED
        GENERATED ALWAYS AS (boxes * items_per_box) STORED,
    remaining_qty BIGINT UNSIGNED NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (lot_id),
    KEY idx_stock_lots_fefo (product_id, expiry_date, lot_id),
    CONSTRAINT fk_stock_lots_product
        FOREIGN KEY (product_id) REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_stock_lots_boxes CHECK (boxes > 0),
    CONSTRAINT chk_stock_lots_items_per_box CHECK (items_per_box > 0),
    CONSTRAINT chk_stock_lots_remaining CHECK (remaining_qty <= received_qty)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_orders (
    sales_order_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    external_order_id VARCHAR(100) NOT NULL,
    source VARCHAR(50) NOT NULL,
    status ENUM('COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'COMPLETED',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (sales_order_id),
    UNIQUE KEY uq_sales_orders_external_id (external_order_id)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS sales_order_items (
    sales_order_item_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    sales_order_id BIGINT UNSIGNED NOT NULL,
    product_id BIGINT UNSIGNED NOT NULL,
    barcode_snapshot VARCHAR(64) NOT NULL,
    product_name_snapshot VARCHAR(255) NOT NULL,
    quantity BIGINT UNSIGNED NOT NULL,
    PRIMARY KEY (sales_order_item_id),
    KEY idx_sales_order_items_order (sales_order_id),
    KEY idx_sales_order_items_product (product_id),
    CONSTRAINT fk_sales_order_items_order
        FOREIGN KEY (sales_order_id) REFERENCES sales_orders (sales_order_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_sales_order_items_product
        FOREIGN KEY (product_id) REFERENCES products (product_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_sales_order_items_quantity CHECK (quantity > 0)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS stock_movements (
    stock_movement_id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    lot_id BIGINT UNSIGNED NOT NULL,
    sales_order_item_id BIGINT UNSIGNED NULL,
    movement_type ENUM('RECEIVE', 'SALE', 'ADJUSTMENT') NOT NULL,
    quantity_change BIGINT NOT NULL,
    note VARCHAR(255) NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (stock_movement_id),
    KEY idx_stock_movements_lot_created (lot_id, created_at),
    KEY idx_stock_movements_order_item (sales_order_item_id),
    CONSTRAINT fk_stock_movements_lot
        FOREIGN KEY (lot_id) REFERENCES stock_lots (lot_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT fk_stock_movements_order_item
        FOREIGN KEY (sales_order_item_id) REFERENCES sales_order_items (sales_order_item_id)
        ON UPDATE CASCADE ON DELETE RESTRICT,
    CONSTRAINT chk_stock_movements_quantity CHECK (
        (movement_type = 'RECEIVE' AND quantity_change > 0)
        OR (movement_type = 'SALE' AND quantity_change < 0)
        OR (movement_type = 'ADJUSTMENT' AND quantity_change <> 0)
    )
) ENGINE=InnoDB;

-- For FEFO deductions, lock eligible lots in expiry_date, lot_id order.
-- Update remaining_qty and insert matching stock_movements in the same transaction.
