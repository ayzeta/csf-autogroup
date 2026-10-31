# Tek tırnaklı bir programın (awk, sed …) içindeki yorum satırında kesme işareti: bash için tırnağı kapatır, program bölünür.
# bash -n çoğu zaman yakalamaz (tırnaklar ileride yeniden dengelenir). Kullanım: awk -f tirnak.awk csf_autogroup.sh
# Çıktı: "SATIR: metin" (her bulgu); bulgu yoksa boş. Basit bir tarayıcı: tek tırnak, çift tırnak, ters bölü kaçışı ve komut yerine
# koyma "$( … )" (çift tırnak içinde de yeni bağlam açar) izlenir.
{
    if (q == 1 && $0 ~ /^[ \t]*#/ && index($0, "'")) print NR ": " $0
    n = length($0)
    for (i = 1; i <= n; i++) {
        c = substr($0, i, 1); nx = substr($0, i + 1, 1)
        if (q == 1) { if (c == "'") q = 0; continue }                       # tek tırnak içi: yalnız ' kapatır
        if (c == "\\") { i++; continue }                                    # kaçış
        if (c == "$" && nx == "(") { D++; ST[D] = q; PC[D] = 0; q = 0; i++; continue }   # komut yerine koyma: yeni bağlam
        if (q == 2) { if (c == "\"") q = 0; continue }                      # çift tırnak içi
        if (D > 0 && c == "(") { PC[D]++; continue }
        if (D > 0 && c == ")") { if (PC[D] > 0) PC[D]--; else { q = ST[D]; D-- }; continue }
        if (c == "#" && (i == 1 || substr($0, i - 1, 1) ~ /[ \t;(]/)) break  # bash yorumu: satırın kalanı
        if (c == "'") q = 1
        else if (c == "\"") q = 2
    }
}
