import sys
lines = open('backend/main.py', 'r', encoding='utf-8').readlines()
for i in range(1440, 1465):
    print(f"Line {i+1}: {repr(lines[i])}")
