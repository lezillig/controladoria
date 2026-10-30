import { redirect } from "next/navigation";

// A frota (veículos, documentos, multas) é da gestão; aqui ficou o lado
// financeiro dela.
export default function FrotaPage() {
  redirect("/frota/financiamentos");
}
