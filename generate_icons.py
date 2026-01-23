import struct
import zlib
import os

def write_png(width, height, data, filename):
    # PNG Signature
    signature = b'\x89PNG\r\n\x1a\n'
    
    # IHDR Chunk
    # Width, Height, Bit depth (8), Color type (2=RGB), Compression (0), Filter (0), Interlace (0)
    ihdr_data = struct.pack('!I I B B B B B', width, height, 8, 2, 0, 0, 0)
    ihdr_crc = zlib.crc32(b'IHDR' + ihdr_data) & 0xffffffff
    ihdr = struct.pack('!I', len(ihdr_data)) + b'IHDR' + ihdr_data + struct.pack('!I', ihdr_crc)
    
    # IDAT Chunk
    # Prepare scanlines
    # For filter type 0 (None), each scanline starts with a 0 byte
    raw_data = b''
    for y in range(height):
        raw_data += b'\x00' # Filter type 0
        for x in range(width):
            r, g, b_val = data[y][x]
            raw_data += struct.pack('BBB', r, g, b_val)
            
    compressed_data = zlib.compress(raw_data)
    idat_crc = zlib.crc32(b'IDAT' + compressed_data) & 0xffffffff
    idat = struct.pack('!I', len(compressed_data)) + b'IDAT' + compressed_data + struct.pack('!I', idat_crc)
    
    # IEND Chunk
    iend_crc = zlib.crc32(b'IEND') & 0xffffffff
    iend = struct.pack('!I', 0) + b'IEND' + struct.pack('!I', iend_crc)
    
    with open(filename, 'wb') as f:
        f.write(signature)
        f.write(ihdr)
        f.write(idat)
        f.write(iend)
    print(f"Generated {filename}")

def generate_icon_data(size):
    # Create a Red background with a white square in the middle
    data = []
    
    bg_color = (220, 53, 69) # Red #dc3545 (Bootstrap Danger)
    fg_color = (255, 255, 255) # White
    
    # Calculate inner square size (approx 50%)
    margin = size // 4
    
    for y in range(size):
        row = []
        for x in range(size):
            if margin <= x < size - margin and margin <= y < size - margin:
                row.append(fg_color)
            else:
                row.append(bg_color)
        data.append(row)
        
    return data

def main():
    sizes = [16, 48, 128]
    output_dir = 'icons'
    
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)
        
    for size in sizes:
        data = generate_icon_data(size)
        filename = os.path.join(output_dir, f'icon{size}.png')
        write_png(size, size, data, filename)

if __name__ == '__main__':
    main()
