# Kurulum testi: bu dosyayı PyCharm'da çalıştırın.
import sys

version = sys.version.split()[0]
print("Python sürümü:", version)

if sys.version_info < (3, 10):
    print("Bu sürüm eski.")
    print("Kurulum sayfasındaki Sık karşılaşılan sorunlar bölümüne bakın.")
else:
    name = input("Adınızı yazıp Enter'a basın: ")
    print("Teşekkürler " + name + ", kurulumunuz tamam.")
